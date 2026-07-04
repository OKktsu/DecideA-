using System.Security.Cryptography;
using System.Text;
using Google.Apis.Auth.OAuth2;
using Google.Cloud.Firestore;

sealed class FirestoreVotingStore : IVotingStore
{
    private readonly FirestoreDb _db;
    private DocumentReference Settings => _db.Collection("votingSettings").Document("current");
    private CollectionReference Presentations => _db.Collection("presentations");
    private CollectionReference Votes => _db.Collection("votes");

    public FirestoreVotingStore(string projectId, string? credentialsPath)
    {
        var builder = new FirestoreDbBuilder { ProjectId = projectId };
        if (!string.IsNullOrWhiteSpace(credentialsPath))
            builder.GoogleCredential = CredentialFactory.FromFile<ServiceAccountCredential>(credentialsPath).ToGoogleCredential();
        _db = builder.Build();
    }

    public async Task<Presentation> AddPresentationAsync(PresentationRequest input)
    {
        var item = new Presentation(Guid.NewGuid(), input.Title.Trim(), input.Presenter?.Trim());
        await Presentations.Document(item.Id.ToString()).SetAsync(new Dictionary<string, object?>
        {
            ["title"] = item.Title,
            ["presenter"] = item.Presenter,
            ["createdAt"] = Timestamp.GetCurrentTimestamp()
        });
        return item;
    }

    public async Task<bool> RemovePresentationAsync(Guid id)
    {
        var presentationRef = Presentations.Document(id.ToString());
        var settingsTask = Settings.GetSnapshotAsync();
        var presentationTask = presentationRef.GetSnapshotAsync();
        var votesTask = Votes.WhereEqualTo("presentationId", id.ToString()).Limit(1).GetSnapshotAsync();
        await Task.WhenAll(settingsTask, presentationTask, votesTask);
        if (!presentationTask.Result.Exists || votesTask.Result.Documents.Count > 0) return false;
        var settings = ReadSettings(settingsTask.Result);
        if (settings.IsOpen && settings.ActivePresentationId == id) return false;
        await presentationRef.DeleteAsync();
        return true;
    }

    public async Task<OperationResult> CastVoteAsync(VoteRequest input)
    {
        if (string.IsNullOrWhiteSpace(input.VoterId)) return new(false, "Identificação do dispositivo ausente.");
        if (input.Score is < 1 or > 10) return new(false, "A nota deve estar entre 1 e 10.");

        return await _db.RunTransactionAsync(async transaction =>
        {
            var settingsSnapshot = await transaction.GetSnapshotAsync(Settings);
            var settings = ReadSettings(settingsSnapshot);
            if (!settings.IsOpen || settings.ActivePresentationId is null) return new OperationResult(false, "A votação não está aberta.");
            if (settings.ActivePresentationId != input.PresentationId) return new OperationResult(false, "Esta apresentação não está mais em votação.");

            var presentationSnapshot = await transaction.GetSnapshotAsync(Presentations.Document(input.PresentationId.ToString()));
            if (!presentationSnapshot.Exists) return new OperationResult(false, "Apresentação não encontrada.");

            var voteRef = Votes.Document(VoteDocumentId(settings.RoundId, input.PresentationId, input.VoterId));
            var existingVote = await transaction.GetSnapshotAsync(voteRef);
            if (existingVote.Exists) return new OperationResult(false, "Você já votou nesta apresentação.");

            transaction.Set(voteRef, new Dictionary<string, object>
            {
                ["roundId"] = settings.RoundId.ToString(),
                ["presentationId"] = input.PresentationId.ToString(),
                ["score"] = input.Score,
                ["voterHash"] = Hash(input.VoterId),
                ["createdAt"] = Timestamp.GetCurrentTimestamp()
            });
            return new OperationResult(true);
        });
    }

    public async Task<OperationResult> SetSessionAsync(bool isOpen, Guid? presentationId, bool showResults)
    {
        if (isOpen)
        {
            if (presentationId is null) return new(false, "Escolha uma apresentação para iniciar a votação.");
            var presentation = await Presentations.Document(presentationId.Value.ToString()).GetSnapshotAsync();
            if (!presentation.Exists) return new(false, "Apresentação não encontrada.");
        }

        var current = ReadSettings(await Settings.GetSnapshotAsync());
        await Settings.SetAsync(new Dictionary<string, object?>
        {
            ["isOpen"] = isOpen,
            ["showResults"] = isOpen ? false : showResults,
            ["activePresentationId"] = isOpen ? presentationId?.ToString() : null,
            ["roundId"] = current.RoundId.ToString(),
            ["updatedAt"] = Timestamp.GetCurrentTimestamp()
        }, SetOptions.MergeAll);
        return new(true);
    }

    public async Task ClearVotesAsync()
    {
        var snapshot = await Votes.GetSnapshotAsync();
        foreach (var chunk in snapshot.Documents.Chunk(450))
        {
            var batch = _db.StartBatch();
            foreach (var document in chunk) batch.Delete(document.Reference);
            await batch.CommitAsync();
        }

        await Settings.SetAsync(new Dictionary<string, object?>
        {
            ["isOpen"] = false,
            ["showResults"] = false,
            ["activePresentationId"] = null,
            ["roundId"] = Guid.NewGuid().ToString(),
            ["updatedAt"] = Timestamp.GetCurrentTimestamp()
        });
    }

    public async Task<VotingSnapshot> SnapshotAsync()
    {
        var settingsTask = Settings.GetSnapshotAsync();
        var presentationsTask = Presentations.GetSnapshotAsync();
        var votesTask = Votes.GetSnapshotAsync();
        await Task.WhenAll(settingsTask, presentationsTask, votesTask);

        var settings = ReadSettings(settingsTask.Result);
        var presentations = presentationsTask.Result.Documents.Select(d =>
        {
            var title = d.ContainsField("title") && d.GetValue<object>("title") is string t ? t : "";
            var presenter = d.ContainsField("presenter") && d.GetValue<object>("presenter") is string p ? p : null;
            return new Presentation(Guid.Parse(d.Id), title, presenter);
        }).ToArray();
        var votes = votesTask.Result.Documents.Select(d =>
        {
            var presIdStr = d.ContainsField("presentationId") && d.GetValue<object>("presentationId") is string idStr ? idStr : "";
            var scoreVal = d.ContainsField("score") ? Convert.ToInt32(d.GetValue<object>("score")) : 0;
            return new
            {
                PresentationId = Guid.TryParse(presIdStr, out var g) ? g : Guid.Empty,
                Score = scoreVal
            };
        }).ToArray();

        var ranking = presentations.Select(p =>
        {
            var presentationVotes = votes.Where(v => v.PresentationId == p.Id).ToArray();
            return new PresentationResult(p.Id, p.Title, p.Presenter, presentationVotes.Length,
                presentationVotes.Length == 0 ? 0 : Math.Round(presentationVotes.Average(v => v.Score), 2));
        }).OrderByDescending(x => x.Average).ThenByDescending(x => x.VoteCount).ThenBy(x => x.Title).ToArray();

        var active = presentations.FirstOrDefault(p => p.Id == settings.ActivePresentationId);
        return new VotingSnapshot(settings.IsOpen, settings.ShowResults, settings.RoundId,
            settings.ActivePresentationId, active, votes.Length, ranking);
    }

    private static SettingsState ReadSettings(DocumentSnapshot snapshot)
    {
        if (!snapshot.Exists) return new(false, false, Guid.NewGuid(), null);
        
        Guid roundId = Guid.NewGuid();
        if (snapshot.ContainsField("roundId"))
        {
            var val = snapshot.GetValue<object>("roundId");
            if (val is string str && Guid.TryParse(str, out var parsedRound))
                roundId = parsedRound;
        }

        Guid? activeId = null;
        if (snapshot.ContainsField("activePresentationId"))
        {
            var val = snapshot.GetValue<object>("activePresentationId");
            if (val is string str && Guid.TryParse(str, out var parsedActive))
                activeId = parsedActive;
        }

        return new(
            snapshot.ContainsField("isOpen") && snapshot.GetValue<object>("isOpen") is bool open && open,
            snapshot.ContainsField("showResults") && snapshot.GetValue<object>("showResults") is bool show && show,
            roundId,
            activeId);
    }

    private static string VoteDocumentId(Guid roundId, Guid presentationId, string voterId) =>
        $"{roundId:N}_{presentationId:N}_{Hash(voterId)}";

    private static string Hash(string value) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();

    private record SettingsState(bool IsOpen, bool ShowResults, Guid RoundId, Guid? ActivePresentationId);
}
