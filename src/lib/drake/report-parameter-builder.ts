import {
  formatDdMmYyyy,
  getCurrentYearDateRange,
  getZonedDateParts,
  type DrakeDateRange,
} from "./date-range";
import { normalizeText } from "./text";
import type { DrakeApiReportDefinition, DrakeExecutionParameter } from "./api-report-types";

export interface PreparedReportPeriod {
  human: DrakeDateRange;
  apiStartDate: string;
  apiEndDate: string;
  timeZone: string;
  parameters: DrakeExecutionParameter[];
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Formato humano (manifesto/logs): DD/MM/YYYY
 */
export function toHumanDate(day: number, month: number, year: number): string {
  return formatDdMmYyyy(day, month, year);
}

/**
 * Formato exigido pela API Drake (observado no raw): YYYY-MM-DD
 */
export function toApiDate(day: number, month: number, year: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function getApiPeriodDates(
  timeZone: string,
  now = new Date(),
): {
  human: DrakeDateRange;
  apiStartDate: string;
  apiEndDate: string;
} {
  const human = getCurrentYearDateRange(timeZone, now);
  const parts = getZonedDateParts(timeZone, now);
  return {
    human,
    apiStartDate: toApiDate(1, 1, parts.year),
    apiEndDate: toApiDate(parts.day, parts.month, parts.year),
  };
}

function parameterIdentity(param: DrakeExecutionParameter): string {
  return normalizeText([param.name, param.columnName ?? "", param.displayText].join(" "));
}

export function isStartDateParameter(param: DrakeExecutionParameter): boolean {
  const identity = parameterIdentity(param);
  if (normalizeText(param.name) === "@ini" || normalizeText(param.name) === "ini") {
    return true;
  }
  return /(?:^|[^a-z])(ini|inicio|datainicio|start|startdate|periodstart)(?:[^a-z]|$)/.test(
    identity,
  );
}

export function isEndDateParameter(param: DrakeExecutionParameter): boolean {
  const identity = parameterIdentity(param);
  if (normalizeText(param.name) === "@fim" || normalizeText(param.name) === "fim") {
    return true;
  }
  return /(?:^|[^a-z])(fim|termino|datafim|end|enddate|periodend)(?:[^a-z]|$)/.test(identity);
}

function cloneParameter(param: DrakeExecutionParameter): DrakeExecutionParameter {
  return {
    ...param,
    wellKnowDomain: param.wellKnowDomain
      ? {
          ...param.wellKnowDomain,
          innerValue: { ...param.wellKnowDomain.innerValue },
        }
      : null,
  };
}

export function buildReportParameters(
  report: DrakeApiReportDefinition,
  timeZone: string,
  now = new Date(),
): PreparedReportPeriod {
  const period = getApiPeriodDates(timeZone, now);
  const parameters = report.parameterTemplate.map(cloneParameter);

  let startFound = false;
  let endFound = false;

  for (const param of parameters) {
    if (isStartDateParameter(param)) {
      param.value = period.apiStartDate;
      startFound = true;
      continue;
    }
    if (isEndDateParameter(param)) {
      param.value = period.apiEndDate;
      endFound = true;
    }
  }

  const expectedCount = report.code === 1 ? 7 : report.code === 14 ? 10 : null;
  if (expectedCount !== null && parameters.length !== expectedCount) {
    throw new Error(
      `Quantidade de parametros inesperada para relatorio ${report.code}: esperado ${expectedCount}, obtido ${parameters.length}.`,
    );
  }

  if (!startFound || !endFound) {
    throw new Error(
      `Parametros de periodo nao encontrados para relatorio ${report.code} (inicio=${startFound}, termino=${endFound}).`,
    );
  }

  return {
    human: period.human,
    apiStartDate: period.apiStartDate,
    apiEndDate: period.apiEndDate,
    timeZone,
    parameters,
  };
}
