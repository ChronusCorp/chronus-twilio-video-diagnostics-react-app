// src/telemetry/types.ts

export interface TokenClaims {
  v: number;
  endpoint: string;
  organization_id: number;
  member_id: number;
  meeting_id: number;
  exp: number;
}

export type TelemetryMode =
  | { mode: 'post'; endpoint: string; rawToken: string; claims: TokenClaims }
  | { mode: 'demo'; reason: 'no-token' | 'malformed' | 'missing-claim' | 'expired-locally' };

export interface ResultsFragment {
  browser?: { ok: boolean; name?: string; version?: string };
  permissions?: { ok: boolean; denied?: string[] };
  camera?: { ok: boolean; error?: string };
  microphone?: { ok: boolean; input_level?: number; error?: string };
  speaker?: { ok: boolean; error?: string };
  network?: {
    ok: boolean;
    signaling_reachable?: boolean;
    turn_reachable?: boolean;
    rtt_ms?: number;
    jitter_ms?: number;
    error?: string;
  };
  twilio_services?: Record<string, string>;
  bitrate?: { ok: boolean; max_kbps?: number; average_kbps?: number; error?: string };
  completed?: boolean;
  quality_score?: string;
}
