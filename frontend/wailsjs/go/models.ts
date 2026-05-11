export namespace bindings {
	
	export class KenoBet {
	    nonce: number;
	    picks: number[];
	    draws: number[];
	    hits: number;
	    multiplier: number;
	
	    static createFrom(source: any = {}) {
	        return new KenoBet(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.nonce = source["nonce"];
	        this.picks = source["picks"];
	        this.draws = source["draws"];
	        this.hits = source["hits"];
	        this.multiplier = source["multiplier"];
	    }
	}
	export class B2BSequence {
	    startNonce: number;
	    endNonce: number;
	    cumulativeMultiplier: number;
	    streakLength: number;
	    bets: KenoBet[];
	
	    static createFrom(source: any = {}) {
	        return new B2BSequence(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.startNonce = source["startNonce"];
	        this.endNonce = source["endNonce"];
	        this.cumulativeMultiplier = source["cumulativeMultiplier"];
	        this.streakLength = source["streakLength"];
	        this.bets = this.convertValues(source["bets"], KenoBet);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Hit {
	    Nonce: number;
	    Metric: number;
	
	    static createFrom(source: any = {}) {
	        return new Hit(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Nonce = source["Nonce"];
	        this.Metric = source["Metric"];
	    }
	}
	export class HitsPage {
	    hits: store.HitWithDelta[];
	    totalCount: number;
	    page: number;
	    perPage: number;
	    totalPages: number;
	
	    static createFrom(source: any = {}) {
	        return new HitsPage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hits = this.convertValues(source["hits"], store.HitWithDelta);
	        this.totalCount = source["totalCount"];
	        this.page = source["page"];
	        this.perPage = source["perPage"];
	        this.totalPages = source["totalPages"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Seeds {
	    Server: string;
	    Client: string;
	
	    static createFrom(source: any = {}) {
	        return new Seeds(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Server = source["Server"];
	        this.Client = source["Client"];
	    }
	}
	export class KenoB2BRequest {
	    seeds: Seeds;
	    nonceStart: any;
	    nonceEnd: any;
	    risk: string;
	    pickCount: number;
	    pickerMode: string;
	    b2bThreshold: number;
	    topN: number;
	
	    static createFrom(source: any = {}) {
	        return new KenoB2BRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.seeds = this.convertValues(source["seeds"], Seeds);
	        this.nonceStart = source["nonceStart"];
	        this.nonceEnd = source["nonceEnd"];
	        this.risk = source["risk"];
	        this.pickCount = source["pickCount"];
	        this.pickerMode = source["pickerMode"];
	        this.b2bThreshold = source["b2bThreshold"];
	        this.topN = source["topN"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class KenoB2BResult {
	    sequences: B2BSequence[];
	    totalFound: number;
	    highestMulti: number;
	    totalEvaluated: number;
	    antebotScript?: string;
	
	    static createFrom(source: any = {}) {
	        return new KenoB2BResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sequences = this.convertValues(source["sequences"], B2BSequence);
	        this.totalFound = source["totalFound"];
	        this.highestMulti = source["highestMulti"];
	        this.totalEvaluated = source["totalEvaluated"];
	        this.antebotScript = source["antebotScript"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class LiveScriptOptions {
	    maxBet?: number;
	    maxTotalWager?: number;
	    maxLoss?: number;
	    maxBets?: number;
	    maxRuntimeSeconds?: number;
	    stopOnSessionError?: boolean;

	    static createFrom(source: any = {}) {
	        return new LiveScriptOptions(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.maxBet = source["maxBet"];
	        this.maxTotalWager = source["maxTotalWager"];
	        this.maxLoss = source["maxLoss"];
	        this.maxBets = source["maxBets"];
	        this.maxRuntimeSeconds = source["maxRuntimeSeconds"];
	        this.stopOnSessionError = source["stopOnSessionError"];
	    }
	}
	export class RunsList {
	    runs: store.Run[];
	    totalCount: number;
	    page: number;
	    perPage: number;
	    totalPages: number;
	
	    static createFrom(source: any = {}) {
	        return new RunsList(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.runs = this.convertValues(source["runs"], store.Run);
	        this.totalCount = source["totalCount"];
	        this.page = source["page"];
	        this.perPage = source["perPage"];
	        this.totalPages = source["totalPages"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class RunsQuery {
	    game?: string;
	    page: number;
	    perPage: number;
	
	    static createFrom(source: any = {}) {
	        return new RunsQuery(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.game = source["game"];
	        this.page = source["page"];
	        this.perPage = source["perPage"];
	    }
	}
	export class ScanRequest {
	    Game: string;
	    Seeds: Seeds;
	    NonceStart: any;
	    NonceEnd: any;
	    Params: Record<string, any>;
	    TargetOp: any;
	    TargetVal: any;
	    Tolerance: number;
	    Limit: number;
	    TimeoutMs: number;
	
	    static createFrom(source: any = {}) {
	        return new ScanRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Game = source["Game"];
	        this.Seeds = this.convertValues(source["Seeds"], Seeds);
	        this.NonceStart = source["NonceStart"];
	        this.NonceEnd = source["NonceEnd"];
	        this.Params = source["Params"];
	        this.TargetOp = source["TargetOp"];
	        this.TargetVal = source["TargetVal"];
	        this.Tolerance = source["Tolerance"];
	        this.Limit = source["Limit"];
	        this.TimeoutMs = source["TimeoutMs"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Summary {
	    Count: number;
	    Min: number;
	    Max: number;
	    Sum: number;
	    TotalEvaluated: number;
	
	    static createFrom(source: any = {}) {
	        return new Summary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Count = source["Count"];
	        this.Min = source["Min"];
	        this.Max = source["Max"];
	        this.Sum = source["Sum"];
	        this.TotalEvaluated = source["TotalEvaluated"];
	    }
	}
	export class ScanResult {
	    RunID: string;
	    Hits: Hit[];
	    Summary: Summary;
	    EngineVersion: string;
	    Echo: ScanRequest;
	    TimedOut: boolean;
	    ServerSeedHash: string;
	
	    static createFrom(source: any = {}) {
	        return new ScanResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.RunID = source["RunID"];
	        this.Hits = this.convertValues(source["Hits"], Hit);
	        this.Summary = this.convertValues(source["Summary"], Summary);
	        this.EngineVersion = source["EngineVersion"];
	        this.Echo = this.convertValues(source["Echo"], ScanRequest);
	        this.TimedOut = source["TimedOut"];
	        this.ServerSeedHash = source["ServerSeedHash"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ScriptSessionSummary {
	    id: string;
	    game: string;
	    currency: string;
	    mode: string;
	    finalState: string;
	    totalBets: number;
	    totalProfit: number;
	    startBalance: number;
	    finalBalance?: number;
	    createdAt: string;
	    endedAt?: string;
	
	    static createFrom(source: any = {}) {
	        return new ScriptSessionSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.game = source["game"];
	        this.currency = source["currency"];
	        this.mode = source["mode"];
	        this.finalState = source["finalState"];
	        this.totalBets = source["totalBets"];
	        this.totalProfit = source["totalProfit"];
	        this.startBalance = source["startBalance"];
	        this.finalBalance = source["finalBalance"];
	        this.createdAt = source["createdAt"];
	        this.endedAt = source["endedAt"];
	    }
	}
	export class ScriptSessionsPage {
	    sessions: ScriptSessionSummary[];
	    totalCount: number;
	
	    static createFrom(source: any = {}) {
	        return new ScriptSessionsPage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sessions = this.convertValues(source["sessions"], ScriptSessionSummary);
	        this.totalCount = source["totalCount"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ScriptState {
	    state: string;
	    error?: string;
	    mode: string;
	    sessionId?: string;
	    bets: number;
	    wins: number;
	    losses: number;
	    profit: number;
	    balance: number;
	    wagered: number;
	    winStreak: number;
	    loseStreak: number;
	    currentGame: string;
	    betsPerSecond: number;
	    chart: scripting.ChartPoint[];
	
	    static createFrom(source: any = {}) {
	        return new ScriptState(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.state = source["state"];
	        this.error = source["error"];
	        this.mode = source["mode"];
	        this.sessionId = source["sessionId"];
	        this.bets = source["bets"];
	        this.wins = source["wins"];
	        this.losses = source["losses"];
	        this.profit = source["profit"];
	        this.balance = source["balance"];
	        this.wagered = source["wagered"];
	        this.winStreak = source["winStreak"];
	        this.loseStreak = source["loseStreak"];
	        this.currentGame = source["currentGame"];
	        this.betsPerSecond = source["betsPerSecond"];
	        this.chart = this.convertValues(source["chart"], scripting.ChartPoint);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SeedGroupSeeds {
	    server: string;
	    serverHash: string;
	    client: string;
	
	    static createFrom(source: any = {}) {
	        return new SeedGroupSeeds(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.server = source["server"];
	        this.serverHash = source["serverHash"];
	        this.client = source["client"];
	    }
	}
	export class SeedRunGroup {
	    seeds: SeedGroupSeeds;
	    runs: store.Run[];
	
	    static createFrom(source: any = {}) {
	        return new SeedRunGroup(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.seeds = this.convertValues(source["seeds"], SeedGroupSeeds);
	        this.runs = this.convertValues(source["runs"], store.Run);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	

}

export namespace games {
	
	export class GameSpec {
	    id: string;
	    name: string;
	    metric_label: string;
	
	    static createFrom(source: any = {}) {
	        return new GameSpec(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.metric_label = source["metric_label"];
	    }
	}

}

export namespace livehttp {
	
	export class AppBetsPage {
	    rows: livestore.AppBet[];
	    total: number;

	    static createFrom(source: any = {}) {
	        return new AppBetsPage(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.rows = this.convertValues(source["rows"], livestore.AppBet);
	        this.total = source["total"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class BetsPage {
	    rows: livestore.LiveBet[];
	    total: number;
	
	    static createFrom(source: any = {}) {
	        return new BetsPage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.rows = this.convertValues(source["rows"], livestore.LiveBet);
	        this.total = source["total"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class IngestInfo {
	    url: string;
	    tokenEnabled: boolean;
	
	    static createFrom(source: any = {}) {
	        return new IngestInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.url = source["url"];
	        this.tokenEnabled = source["tokenEnabled"];
	    }
	}
	export class RoundsPage {
	    rows: livestore.LiveRound[];
	    total: number;
	
	    static createFrom(source: any = {}) {
	        return new RoundsPage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.rows = this.convertValues(source["rows"], livestore.LiveRound);
	        this.total = source["total"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class StreamWithRounds {
	    stream: livestore.LiveStream;
	    rounds: livestore.LiveRound[];
	
	    static createFrom(source: any = {}) {
	        return new StreamWithRounds(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.stream = this.convertValues(source["stream"], livestore.LiveStream);
	        this.rounds = this.convertValues(source["rounds"], livestore.LiveRound);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class TailResponse {
	    rows: livestore.LiveBet[];
	    lastID: number;
	
	    static createFrom(source: any = {}) {
	        return new TailResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.rows = this.convertValues(source["rows"], livestore.LiveBet);
	        this.lastID = source["lastID"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class TailRoundsResponse {
	    rows: livestore.LiveRound[];
	    lastNonce: number;
	
	    static createFrom(source: any = {}) {
	        return new TailRoundsResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.rows = this.convertValues(source["rows"], livestore.LiveRound);
	        this.lastNonce = source["lastNonce"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace livestore {
	
	export class AppBet {
	    id: number;
	    account_id: string;
	    script_session_id: string;
	    game: string;
	    currency: string;
	    amount: number;
	    condition: string;
	    target: number;
	    multiplier: number;
	    stake_response_id: string;
	    stake_response_hash: string;
	    payout: number;
	    profit: number;
	    error_kind: string;
	    // Go type: time
	    created_at: any;
	    // Go type: time
	    placed_at: any;

	    static createFrom(source: any = {}) {
	        return new AppBet(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.account_id = source["account_id"];
	        this.script_session_id = source["script_session_id"];
	        this.game = source["game"];
	        this.currency = source["currency"];
	        this.amount = source["amount"];
	        this.condition = source["condition"];
	        this.target = source["target"];
	        this.multiplier = source["multiplier"];
	        this.stake_response_id = source["stake_response_id"];
	        this.stake_response_hash = source["stake_response_hash"];
	        this.payout = source["payout"];
	        this.profit = source["profit"];
	        this.error_kind = source["error_kind"];
	        this.created_at = this.convertValues(source["created_at"], null);
	        this.placed_at = this.convertValues(source["placed_at"], null);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class LiveBet {
	    id: number;
	    stream_id: number[];
	    antebot_bet_id: string;
	    // Go type: time
	    received_at: any;
	    // Go type: time
	    date_time: any;
	    nonce: number;
	    amount: number;
	    payout: number;
	    difficulty: string;
	    round_target: number;
	    round_result: number;
	
	    static createFrom(source: any = {}) {
	        return new LiveBet(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.stream_id = source["stream_id"];
	        this.antebot_bet_id = source["antebot_bet_id"];
	        this.received_at = this.convertValues(source["received_at"], null);
	        this.date_time = this.convertValues(source["date_time"], null);
	        this.nonce = source["nonce"];
	        this.amount = source["amount"];
	        this.payout = source["payout"];
	        this.difficulty = source["difficulty"];
	        this.round_target = source["round_target"];
	        this.round_result = source["round_result"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class LiveRound {
	    id: number;
	    stream_id: number[];
	    nonce: number;
	    round_result: number;
	    // Go type: time
	    received_at: any;
	
	    static createFrom(source: any = {}) {
	        return new LiveRound(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.stream_id = source["stream_id"];
	        this.nonce = source["nonce"];
	        this.round_result = source["round_result"];
	        this.received_at = this.convertValues(source["received_at"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class LiveStream {
	    id: number[];
	    server_seed_hashed: string;
	    client_seed: string;
	    // Go type: time
	    created_at: any;
	    // Go type: time
	    last_seen_at: any;
	    notes: string;
	    total_bets: number;
	    highest_result: number;
	    last_observed_nonce: number;
	    // Go type: time
	    last_observed_at: any;
	
	    static createFrom(source: any = {}) {
	        return new LiveStream(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.server_seed_hashed = source["server_seed_hashed"];
	        this.client_seed = source["client_seed"];
	        this.created_at = this.convertValues(source["created_at"], null);
	        this.last_seen_at = this.convertValues(source["last_seen_at"], null);
	        this.notes = source["notes"];
	        this.total_bets = source["total_bets"];
	        this.highest_result = source["highest_result"];
	        this.last_observed_nonce = source["last_observed_nonce"];
	        this.last_observed_at = this.convertValues(source["last_observed_at"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace scripting {
	
	export class ChartPoint {
	    x: number;
	    y: number;
	    win: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ChartPoint(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.x = source["x"];
	        this.y = source["y"];
	        this.win = source["win"];
	    }
	}
	export class LogEntry {
	    // Go type: time
	    time: any;
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new LogEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.time = this.convertValues(source["time"], null);
	        this.message = source["message"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace scriptstore {
	
	export class ScriptBet {
	    id: number;
	    sessionId: string;
	    nonce: number;
	    amount: number;
	    payout: number;
	    payoutMulti: number;
	    win: boolean;
	    roll?: number;
	    // Go type: time
	    createdAt: any;
	
	    static createFrom(source: any = {}) {
	        return new ScriptBet(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.sessionId = source["sessionId"];
	        this.nonce = source["nonce"];
	        this.amount = source["amount"];
	        this.payout = source["payout"];
	        this.payoutMulti = source["payoutMulti"];
	        this.win = source["win"];
	        this.roll = source["roll"];
	        this.createdAt = this.convertValues(source["createdAt"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ScriptBetsPage {
	    bets: ScriptBet[];
	    totalCount: number;
	    page: number;
	    perPage: number;
	    totalPages: number;
	
	    static createFrom(source: any = {}) {
	        return new ScriptBetsPage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.bets = this.convertValues(source["bets"], ScriptBet);
	        this.totalCount = source["totalCount"];
	        this.page = source["page"];
	        this.perPage = source["perPage"];
	        this.totalPages = source["totalPages"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ScriptSession {
	    id: string;
	    name: string;
	    game: string;
	    currency: string;
	    mode: string;
	    scriptSource: string;
	    startBalance: number;
	    finalBalance?: number;
	    // Go type: time
	    createdAt: any;
	    // Go type: time
	    endedAt?: any;
	    finalState: string;
	    totalBets: number;
	    totalWins: number;
	    totalLosses: number;
	    totalProfit: number;
	    totalWagered: number;
	    highestStreak: number;
	    lowestStreak: number;
	
	    static createFrom(source: any = {}) {
	        return new ScriptSession(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.game = source["game"];
	        this.currency = source["currency"];
	        this.mode = source["mode"];
	        this.scriptSource = source["scriptSource"];
	        this.startBalance = source["startBalance"];
	        this.finalBalance = source["finalBalance"];
	        this.createdAt = this.convertValues(source["createdAt"], null);
	        this.endedAt = this.convertValues(source["endedAt"], null);
	        this.finalState = source["finalState"];
	        this.totalBets = source["totalBets"];
	        this.totalWins = source["totalWins"];
	        this.totalLosses = source["totalLosses"];
	        this.totalProfit = source["totalProfit"];
	        this.totalWagered = source["totalWagered"];
	        this.highestStreak = source["highestStreak"];
	        this.lowestStreak = source["lowestStreak"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace stake {
	
	export class Client {
	
	
	    static createFrom(source: any = {}) {
	        return new Client(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	
	    }
	}

}

export namespace stakeauth {
	
	export class Account {
	    id: string;
	    label: string;
	    mirror: string;
	    currency: string;
	    profileId: string;
	    connectionState: string;
	    lastCheckAt?: string;
	    createdAt: string;
	    updatedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new Account(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.label = source["label"];
	        this.mirror = source["mirror"];
	        this.currency = source["currency"];
	        this.profileId = source["profileId"];
	        this.connectionState = source["connectionState"];
	        this.lastCheckAt = source["lastCheckAt"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	    }
	}
	export class SessionBalance {
	    currency: string;
	    available: number;
	    vault: number;
	
	    static createFrom(source: any = {}) {
	        return new SessionBalance(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.currency = source["currency"];
	        this.available = source["available"];
	        this.vault = source["vault"];
	    }
	}
	export class StateReason {
	    code?: string;
	    message?: string;
	
	    static createFrom(source: any = {}) {
	        return new StateReason(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.code = source["code"];
	        this.message = source["message"];
	    }
	}
	export class ActiveStatus {
	    connected: boolean;
	    state: string;
	    reason?: StateReason;
	    lastCheckAt?: string;
	    accountId?: string;
	    account?: Account;
	    error?: string;
	    balances?: SessionBalance[];
	
	    static createFrom(source: any = {}) {
	        return new ActiveStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.connected = source["connected"];
	        this.state = source["state"];
	        this.reason = this.convertValues(source["reason"], StateReason);
	        this.lastCheckAt = source["lastCheckAt"];
	        this.accountId = source["accountId"];
	        this.account = this.convertValues(source["account"], Account);
	        this.error = source["error"];
	        this.balances = this.convertValues(source["balances"], SessionBalance);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ConnectionStep {
	    name: string;
	    success: boolean;
	    message?: string;
	
	    static createFrom(source: any = {}) {
	        return new ConnectionStep(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.success = source["success"];
	        this.message = source["message"];
	    }
	}
	export class ConnectionCheckResult {
	    ok: boolean;
	    state: string;
	    reason?: StateReason;
	    lastCheckAt?: string;
	    steps: ConnectionStep[];
	
	    static createFrom(source: any = {}) {
	        return new ConnectionCheckResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.state = source["state"];
	        this.reason = this.convertValues(source["reason"], StateReason);
	        this.lastCheckAt = source["lastCheckAt"];
	        this.steps = this.convertValues(source["steps"], ConnectionStep);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class SecretsMasked {
	    hasApiKey: boolean;
	    hasClearance: boolean;
	    hasUserAgent: boolean;
	
	    static createFrom(source: any = {}) {
	        return new SecretsMasked(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hasApiKey = source["hasApiKey"];
	        this.hasClearance = source["hasClearance"];
	        this.hasUserAgent = source["hasUserAgent"];
	    }
	}
	

}

export namespace store {
	
	export class HitWithDelta {
	    id: number;
	    run_id: string;
	    nonce: number;
	    metric: number;
	    details: string;
	    delta_nonce?: number;
	
	    static createFrom(source: any = {}) {
	        return new HitWithDelta(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.run_id = source["run_id"];
	        this.nonce = source["nonce"];
	        this.metric = source["metric"];
	        this.details = source["details"];
	        this.delta_nonce = source["delta_nonce"];
	    }
	}
	export class Run {
	    id: string;
	    game: string;
	    server_seed: string;
	    server_seed_hash: string;
	    client_seed: string;
	    nonce_start: number;
	    nonce_end: number;
	    params_json: string;
	    target_op: string;
	    target_val: number;
	    tolerance: number;
	    hit_limit: number;
	    timed_out: boolean;
	    hit_count: number;
	    total_evaluated: number;
	    summary_min?: number;
	    summary_max?: number;
	    summary_sum?: number;
	    summary_count: number;
	    engine_version: string;
	    // Go type: time
	    created_at: any;
	
	    static createFrom(source: any = {}) {
	        return new Run(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.game = source["game"];
	        this.server_seed = source["server_seed"];
	        this.server_seed_hash = source["server_seed_hash"];
	        this.client_seed = source["client_seed"];
	        this.nonce_start = source["nonce_start"];
	        this.nonce_end = source["nonce_end"];
	        this.params_json = source["params_json"];
	        this.target_op = source["target_op"];
	        this.target_val = source["target_val"];
	        this.tolerance = source["tolerance"];
	        this.hit_limit = source["hit_limit"];
	        this.timed_out = source["timed_out"];
	        this.hit_count = source["hit_count"];
	        this.total_evaluated = source["total_evaluated"];
	        this.summary_min = source["summary_min"];
	        this.summary_max = source["summary_max"];
	        this.summary_sum = source["summary_sum"];
	        this.summary_count = source["summary_count"];
	        this.engine_version = source["engine_version"];
	        this.created_at = this.convertValues(source["created_at"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}
