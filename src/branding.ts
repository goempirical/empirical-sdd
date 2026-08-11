export const BRAND_RED = "#F43737" as const;
export const BRAND_YELLOW = "#FFCD15" as const;
export const BRAND_BLUE = "#4A5CFF" as const;

const ANSI_RESET = "\u001b[0m";
const WIDE_COLUMNS = 40;
const COMPACT_COLUMNS = 20;
const RED_ANSI = "\u001b[38;2;244;55;55m";
const YELLOW_ANSI = "\u001b[38;2;255;205;21m";
const BLUE_ANSI = "\u001b[38;2;74;92;255m";

export interface BrandBannerOptions {
  version: string;
  columns?: number;
  color?: boolean;
}

export interface BrandBannerOutput {
  isTTY?: boolean;
  columns?: number;
}

export type BrandBannerEnvironment = Readonly<Record<string, string | undefined>>;

export function renderBrandBanner(options: BrandBannerOptions): string {
  const columns = normalizeColumns(options.columns);
  const color = options.color ?? false;
  const version = `v${options.version.replace(/^v/, "")}`;
  if (columns < COMPACT_COLUMNS) return renderMicroMark(color).concat("empirical", version).join("\n");

  const mark = renderFullMark(color);
  if (columns < WIDE_COLUMNS) return mark.concat("", `empirical ${version}`).join("\n");

  mark[2] = `${mark[2]}    empirical`;
  mark[3] = `${mark[3]}    ${version}`;
  return mark.join("\n");
}

export function renderBrandBannerForOutput(
  version: string,
  output: BrandBannerOutput = process.stdout,
  environment: BrandBannerEnvironment = process.env,
): string {
  const interactive = output.isTTY === true;
  return renderBrandBanner({
    version,
    columns: interactive ? output.columns ?? 80 : 24,
    color: interactive
      && environment.TERM?.toLowerCase() !== "dumb"
      && !Object.hasOwn(environment, "NO_COLOR"),
  });
}

function renderFullMark(color: boolean): string[] {
  return [
    blue("       ╭────╮", color),
    blue("       │    │", color),
    `${yellow("   ╭───", color)}${blue("╯    ╰", color)}${red("───╮", color)}`,
    `${yellow("   │", color)}            ${red("│", color)}`,
    `${yellow("   ╰───╮", color)}    ${red("╭───╯", color)}`,
    `       ${yellow("│", color)}    ${red("│", color)}`,
    `       ${yellow("╰──", color)}${red("──╯", color)}`,
  ];
}

function renderMicroMark(color: boolean): string[] {
  return [
    `  ${blue("○", color)}`,
    `${yellow("○", color)}   ${red("○", color)}`,
  ];
}

function red(value: string, color: boolean): string {
  return colorize(value, RED_ANSI, color);
}

function yellow(value: string, color: boolean): string {
  return colorize(value, YELLOW_ANSI, color);
}

function blue(value: string, color: boolean): string {
  return colorize(value, BLUE_ANSI, color);
}

function colorize(value: string, ansiColor: string, color: boolean): string {
  return color ? `${ansiColor}${value}${ANSI_RESET}` : value;
}

function normalizeColumns(columns: number | undefined): number {
  if (columns === undefined || !Number.isFinite(columns) || columns <= 0) return 80;
  return Math.floor(columns);
}
