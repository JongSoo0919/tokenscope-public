export interface SessionFile {
  session_id: string;
  project: string;
  project_path?: string;
  external_session_name?: string;
  path: string;
  size_bytes: number;
  modified: number;
}

export interface ReadResult {
  content: string;
  path: string;
}
