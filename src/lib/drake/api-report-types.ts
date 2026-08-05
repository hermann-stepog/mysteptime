export type DrakeQueryType = "Deployed" | string;

export type DrakeDbType = "String" | "Date" | "Number" | "Boolean" | string;

export interface DrakeWellKnowDomain {
  id: string | null;
  name: string | null;
  text: string | null;
  innerValue: Record<string, unknown>;
}

export interface DrakeExecutionParameter {
  operator: string;
  isPreFilter: boolean;
  name: string;
  columnName?: string;
  displayText: string;
  value: string;
  dbType: DrakeDbType;
  wellKnowDomain: DrakeWellKnowDomain | null;
  multiSelect: boolean;
}

export interface DrakeApiReportDefinition {
  code: number;
  name: string;
  queryId: string;
  queryType: DrakeQueryType;
  outputBaseName: string;
  parameterTemplate: DrakeExecutionParameter[];
}

export interface DrakeQueryDefinitionResponse {
  id: string;
  code: number;
  name: string;
  enabled?: boolean;
  tenantName?: string;
  queryType?: string;
  parameters?: unknown[];
}

export interface DrakeExecuteRequest {
  executionParameters: DrakeExecutionParameter[];
  queryId: string;
  skip: number;
  take: number;
  executionRequestId: string;
  signalRConnectionId?: string | null;
  queryType: string;
}

export interface DrakeExecuteResponse {
  scheduled?: boolean;
  scheduledBackgroundJobId?: string | null;
  columns?: unknown[];
  rows?: unknown[];
  totalRows?: number;
}

export interface DrakeExportRequest {
  params: DrakeExecutionParameter[];
  queryId: string;
  queryCode: number;
  queryName: string;
  signalRConnectionId?: string | null;
}

/**
 * Status observado no raw da descoberta.
 * ReadyForDownload foi o status final com zipFile/zipFileName.
 */
export type BackgroundJobStatus = "ReadyForDownload" | string;

export interface BackgroundExecutionRequestItem {
  requestDate: string;
  code: number;
  description: string | null;
  zipFile: string | null;
  zipFileName: string | null;
  zipFileIsTemporary?: boolean | null;
  requestContext: string | null;
  status: BackgroundJobStatus;
  errorOutput: string | null;
  requestContextArgs: unknown;
  requestContextArgsType: string | null;
  id: string;
}

export interface ApiDownloadedReport {
  reportCode: number;
  reportName: string;
  queryId: string;
  queryCode: number;
  queryName: string;
  strategyUsed: "direct-export" | "execute-then-export";
  signalRUsed: boolean;
  period: {
    startDate: string;
    endDate: string;
    apiStartDate: string;
    apiEndDate: string;
    timeZone: string;
  };
  /** Caminho opcional no disco (run downloads); preferir `buffer` em memória. */
  filePath: string | null;
  buffer: Buffer;
  sizeBytes: number;
  extension: string;
  sha256?: string;
  startedAt: string;
  finishedAt: string;
  success: boolean;
  error: string | null;
}

export interface ApiFailedReport {
  reportCode: number;
  reportName: string;
  queryId: string;
  queryCode: number;
  queryName: string;
  strategyUsed: "direct-export" | "execute-then-export";
  signalRUsed: boolean;
  period: null;
  filePath: null;
  sizeBytes: null;
  extension: null;
  startedAt: string;
  finishedAt: string;
  success: false;
  error: string;
}

export interface ApiReportError {
  reportCode: number;
  reportName: string;
  queryId: string;
  message: string;
  stage: string;
}

export interface ApiReportsManifest {
  startedAt: string;
  finishedAt: string;
  success: boolean;
  mode: "http-api";
  reports: Array<ApiDownloadedReport | ApiFailedReport>;
  errors: ApiReportError[];
}

export interface ApiReportDiagnostic {
  stage: string;
  httpStatus: number | null;
  endpoint: string;
  contentType?: string;
  reportCode: number;
  queryId: string;
  parameterCount: number;
  parameterNames: string[];
  jobStatus: string | null;
  strategyUsed?: "direct-export" | "execute-then-export";
  signalRUsed: boolean;
  requiredFields?: string[];
  errorMessage: string;
  durationMs: number;
  timestamp: string;
}
