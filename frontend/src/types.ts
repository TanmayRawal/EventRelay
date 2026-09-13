export interface Endpoint {
  id: string;
  name: string;
  url: string;
  rate_limit_rps: number;
  circuit_state: string;
  circuit_failures: number;
  secret_preview?: string;
  max_retries?: number;
}

export interface Delivery {
  id: string;
  event_id: string;
  event_type: string;
  endpoint_name: string;
  attempt_number: number;
  http_status: number | null;
  duration_ms: number | null;
  error_message: string | null;
  status: 'SUCCESS' | 'RETRYING' | 'DEAD_LETTER';
  created_at: string;
}

export type ActiveTab = 'deliveries' | 'endpoints' | 'dlq' | 'test';
export type ScenarioType = 'happy' | 'idempotent' | 'circuit' | 'dlq';
