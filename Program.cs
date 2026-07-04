using System.Collections.Concurrent;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSingleton<LiveUpdates>();

var firebaseEnabled = builder.Configuration.GetValue<bool>("Firebase:Enabled");
if (firebaseEnabled)
{
    var projectId = builder.Configuration["Firebase:ProjectId"];
    var credentialsPath = builder.Configuration["Firebase:CredentialsPath"];
    if (string.IsNullOrWhiteSpace(projectId))
        throw new InvalidOperationException("Firebase:ProjectId precisa ser configurado.");
    if (!string.IsNullOrWhiteSpace(credentialsPath) && !Path.IsPathRooted(credentialsPath))
        credentialsPath = Path.GetFullPath(credentialsPath, builder.Environment.ContentRootPath);

    builder.Services.AddSingleton<IVotingStore>(_ => new FirestoreVotingStore(projectId, credentialsPath));
}
else
{
    builder.Services.AddSingleton<IVotingStore, MemoryVotingStore>();
}

var app = builder.Build();
app.UseDefaultFiles();
app.UseStaticFiles();

var adminPin = builder.Configuration["Admin:Pin"] ?? "1234";
bool IsAdmin(HttpRequest request) =>
    request.Headers.TryGetValue("X-Admin-Pin", out var pin) && pin == adminPin;

app.MapGet("/api/state", async (IVotingStore store) => Results.Ok(await store.SnapshotAsync()));

app.MapPost("/api/votes", async (VoteRequest vote, IVotingStore store, LiveUpdates updates) =>
{
    var result = await store.CastVoteAsync(vote);
    if (!result.Success) return Results.BadRequest(new { message = result.Error });
    updates.Publish("changed");
    return Results.Ok(new { message = "Voto registrado com sucesso." });
});

app.MapPost("/api/admin/presentations", async (PresentationRequest input, HttpRequest request, IVotingStore store, LiveUpdates updates) =>
{
    if (!IsAdmin(request)) return Results.Unauthorized();
    if (string.IsNullOrWhiteSpace(input.Title)) return Results.BadRequest(new { message = "Informe o nome da apresentação." });
    var presentation = await store.AddPresentationAsync(input);
    updates.Publish("changed");
    return Results.Created($"/api/presentations/{presentation.Id}", presentation);
});

app.MapDelete("/api/admin/presentations/{id:guid}", async (Guid id, HttpRequest request, IVotingStore store, LiveUpdates updates) =>
{
    if (!IsAdmin(request)) return Results.Unauthorized();
    if (!await store.RemovePresentationAsync(id)) return Results.NotFound();
    updates.Publish("changed");
    return Results.NoContent();
});

app.MapPut("/api/admin/session", async (SessionRequest input, HttpRequest request, IVotingStore store, LiveUpdates updates) =>
{
    if (!IsAdmin(request)) return Results.Unauthorized();
    var result = await store.SetSessionAsync(input.IsOpen, input.PresentationId, input.ShowResults);
    if (!result.Success) return Results.BadRequest(new { message = result.Error });
    updates.Publish("changed");
    return Results.Ok(await store.SnapshotAsync());
});

app.MapDelete("/api/admin/votes", async (HttpRequest request, IVotingStore store, LiveUpdates updates) =>
{
    if (!IsAdmin(request)) return Results.Unauthorized();
    await store.ClearVotesAsync();
    updates.Publish("changed");
    return Results.NoContent();
});

app.MapGet("/api/events", async (HttpContext context, LiveUpdates updates) =>
{
    context.Response.ContentType = "text/event-stream";
    context.Response.Headers.CacheControl = "no-cache";
    var subscription = updates.Subscribe();
    try
    {
        await context.Response.WriteAsync("data: connected\n\n", context.RequestAborted);
        await context.Response.Body.FlushAsync(context.RequestAborted);
        await foreach (var message in subscription.Reader.ReadAllAsync(context.RequestAborted))
        {
            await context.Response.WriteAsync($"data: {message}\n\n", context.RequestAborted);
            await context.Response.Body.FlushAsync(context.RequestAborted);
        }
    }
    catch (OperationCanceledException) { }
    finally { updates.Unsubscribe(subscription.Id); }
});

app.MapFallbackToFile("index.html");
app.Run();

record PresentationRequest(string Title, string? Presenter);
record VoteRequest(Guid PresentationId, int Score, string VoterId);
record SessionRequest(bool IsOpen, Guid? PresentationId, bool ShowResults = false);
record OperationResult(bool Success, string? Error = null);
record Presentation(Guid Id, string Title, string? Presenter);
record PresentationResult(Guid Id, string Title, string? Presenter, int VoteCount, double Average);
record VotingSnapshot(bool IsOpen, bool ShowResults, Guid RoundId, Guid? ActivePresentationId,
    Presentation? ActivePresentation, int TotalVotes, IReadOnlyList<PresentationResult> Presentations);
record Vote(Guid PresentationId, int Score, DateTimeOffset CreatedAt);

interface IVotingStore
{
    Task<Presentation> AddPresentationAsync(PresentationRequest input);
    Task<bool> RemovePresentationAsync(Guid id);
    Task<OperationResult> CastVoteAsync(VoteRequest input);
    Task<OperationResult> SetSessionAsync(bool isOpen, Guid? presentationId, bool showResults);
    Task ClearVotesAsync();
    Task<VotingSnapshot> SnapshotAsync();
}

sealed class MemoryVotingStore : IVotingStore
{
    private readonly object _gate = new();
    private readonly List<Presentation> _presentations = [];
    private readonly Dictionary<(Guid PresentationId, string VoterId), Vote> _votes = [];
    private bool _isOpen;
    private bool _showResults;
    private Guid? _activePresentationId;
    private Guid _roundId = Guid.NewGuid();

    public Task<Presentation> AddPresentationAsync(PresentationRequest input)
    {
        lock (_gate)
        {
            var item = new Presentation(Guid.NewGuid(), input.Title.Trim(), input.Presenter?.Trim());
            _presentations.Add(item);
            return Task.FromResult(item);
        }
    }

    public Task<bool> RemovePresentationAsync(Guid id)
    {
        lock (_gate)
        {
            if ((_isOpen && _activePresentationId == id) || _votes.Values.Any(v => v.PresentationId == id))
                return Task.FromResult(false);
            return Task.FromResult(_presentations.RemoveAll(p => p.Id == id) > 0);
        }
    }

    public Task<OperationResult> CastVoteAsync(VoteRequest input)
    {
        lock (_gate)
        {
            if (!_isOpen || _activePresentationId is null) return Task.FromResult(new OperationResult(false, "A votação não está aberta."));
            if (string.IsNullOrWhiteSpace(input.VoterId)) return Task.FromResult(new OperationResult(false, "Identificação do dispositivo ausente."));
            if (input.Score is < 1 or > 10) return Task.FromResult(new OperationResult(false, "A nota deve estar entre 1 e 10."));
            if (_presentations.All(p => p.Id != input.PresentationId)) return Task.FromResult(new OperationResult(false, "Apresentação não encontrada."));
            if (input.PresentationId != _activePresentationId) return Task.FromResult(new OperationResult(false, "Esta apresentação não está mais em votação."));
            var voteKey = (input.PresentationId, input.VoterId);
            if (_votes.ContainsKey(voteKey)) return Task.FromResult(new OperationResult(false, "Você já votou nesta apresentação."));
            _votes[voteKey] = new Vote(input.PresentationId, input.Score, DateTimeOffset.UtcNow);
            return Task.FromResult(new OperationResult(true));
        }
    }

    public Task<OperationResult> SetSessionAsync(bool isOpen, Guid? presentationId, bool showResults)
    {
        lock (_gate)
        {
            if (!isOpen)
            {
                _isOpen = false;
                _showResults = showResults;
                _activePresentationId = null;
                return Task.FromResult(new OperationResult(true));
            }

            if (presentationId is null || _presentations.All(p => p.Id != presentationId))
                return Task.FromResult(new OperationResult(false, "Escolha uma apresentação para iniciar a votação."));

            _activePresentationId = presentationId;
            _isOpen = true;
            _showResults = false;
            return Task.FromResult(new OperationResult(true));
        }
    }

    public Task ClearVotesAsync()
    {
        lock (_gate)
        {
            _votes.Clear();
            _isOpen = false;
            _showResults = false;
            _activePresentationId = null;
            _roundId = Guid.NewGuid();
            return Task.CompletedTask;
        }
    }

    public Task<VotingSnapshot> SnapshotAsync()
    {
        lock (_gate)
        {
            var ranking = _presentations.Select(p =>
            {
                var votes = _votes.Values.Where(v => v.PresentationId == p.Id).ToArray();
                return new PresentationResult(p.Id, p.Title, p.Presenter, votes.Length,
                    votes.Length == 0 ? 0 : Math.Round(votes.Average(v => v.Score), 2));
            }).OrderByDescending(x => x.Average).ThenByDescending(x => x.VoteCount).ThenBy(x => x.Title).ToArray();
            var active = _presentations.FirstOrDefault(p => p.Id == _activePresentationId);
            return Task.FromResult(new VotingSnapshot(_isOpen, _showResults, _roundId, _activePresentationId,
                active, _votes.Count, ranking));
        }
    }
}

sealed class LiveUpdates
{
    private readonly ConcurrentDictionary<Guid, System.Threading.Channels.Channel<string>> _clients = new();
    public (Guid Id, System.Threading.Channels.ChannelReader<string> Reader) Subscribe()
    {
        var id = Guid.NewGuid();
        var channel = System.Threading.Channels.Channel.CreateUnbounded<string>();
        _clients[id] = channel;
        return (id, channel.Reader);
    }
    public void Unsubscribe(Guid id) => _clients.TryRemove(id, out _);
    public void Publish(string message)
    {
        foreach (var channel in _clients.Values) channel.Writer.TryWrite(message);
    }
}
