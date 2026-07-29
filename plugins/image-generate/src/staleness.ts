/**
 * Advisory staleness check for the pinned image models.
 *
 * The models in models.ts are pinned on purpose. This check exists so that
 * pinning cannot rot invisibly — the exact failure that killed the old
 * `shared/model-aliases.json` snapshot, which stayed "healthy-looking" for four
 * months while resolving dead IDs.
 *
 * Rules:
 *   - ADVISORY ONLY. It never changes which model is used.
 *   - It never blocks or slows a generation: results are cached for 24h and a
 *     failed check is silent.
 *   - It fails CLOSED on ambiguity. If the endpoint is not deployed yet, or the
 *     response is not recognisably the image catalog, it reports nothing rather
 *     than guessing from a generic model list.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { listModels, type PinnedModel } from "./models.js";

const CATALOG_URL =
  "https://us-central1-claudish-6da10.cloudfunctions.net/queryModels?catalog=image&limit=50";

/** Same 24h TTL claudish uses for all Firebase-derived data. One knob. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_PATH = join(tmpdir(), "magus-image-generate", "image-catalog.json");

interface CatalogEntry {
  modelId: string;
  provider?: string;
  releaseDate?: string;
  status?: string;
}

interface CatalogResponse {
  /** Present only on the real image catalog — used to detect a stale deploy. */
  catalog?: string;
  models?: CatalogEntry[];
}

export interface StalenessSuggestion {
  pinned: PinnedModel;
  /** Newer models from the same provider, newest first. */
  newer: CatalogEntry[];
}

export interface StalenessReport {
  suggestions: StalenessSuggestion[];
  checkedAt: string;
}

function readCache(): CatalogResponse | null {
  try {
    if (!existsSync(CACHE_PATH)) return null;
    const raw = JSON.parse(readFileSync(CACHE_PATH, "utf8")) as {
      fetchedAt: number;
      body: CatalogResponse;
    };
    if (Date.now() - raw.fetchedAt > CACHE_TTL_MS) return null;
    return raw.body;
  } catch {
    return null;
  }
}

function writeCache(body: CatalogResponse): void {
  try {
    mkdirSync(dirname(CACHE_PATH), { recursive: true });
    writeFileSync(CACHE_PATH, JSON.stringify({ fetchedAt: Date.now(), body }), "utf8");
  } catch {
    /* cache is best-effort */
  }
}

async function fetchCatalog(): Promise<CatalogResponse | null> {
  const cached = readCache();
  if (cached) return cached;

  try {
    const res = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const body = (await res.json()) as CatalogResponse;

    // The endpoint is still being built (see models-index
    // TASK_image_catalog_endpoint.md). Until it ships, an unknown `catalog`
    // param falls through to the generic model query and returns an arbitrary
    // page of models — which would produce nonsense suggestions. Require the
    // response to identify itself before trusting it.
    if (body.catalog !== "image" || !Array.isArray(body.models)) return null;

    writeCache(body);
    return body;
  } catch {
    return null;
  }
}

/** ISO date compare; anything unparseable is treated as older, never newer. */
function isNewer(candidate?: string, than?: string): boolean {
  if (!candidate || !than) return false;
  return candidate > than;
}

/**
 * Reduced-capability variants of a family. A later release date does NOT make
 * these an upgrade — `gemini-3.1-flash-lite-image` shipped after our pin but at
 * half the price and a lower tier.
 *
 * Suggesting one would repeat the exact mistake this plugin exists to prevent:
 * treating "newer name" as "better model". Newer is a necessary condition for a
 * suggestion, never a sufficient one.
 */
const DOWNGRADE_MARKER = /(^|[-_.])(lite|mini|nano|small|tiny)([-_.]|$)/i;

function isTierDowngrade(candidateId: string, pinnedId: string): boolean {
  // Only a downgrade if the CANDIDATE is a reduced variant and the pin is not.
  return DOWNGRADE_MARKER.test(candidateId) && !DOWNGRADE_MARKER.test(pinnedId);
}

/**
 * The catalog selects on `imageOutput`, which also matches multimodal chat
 * models that merely *can* emit an image (deep-research-*, *-omni-*). Those are
 * not plausible replacements for a dedicated image generator.
 *
 * Heuristic, deliberately: when the pinned model is a dedicated image model
 * (its ID says so), require candidates to be too. Better to under-suggest than
 * to bury a real recommendation in noise.
 */
function isSameKind(candidateId: string, pinnedId: string): boolean {
  const pinnedIsImageModel = /image/i.test(pinnedId);
  if (!pinnedIsImageModel) return true;
  return /image/i.test(candidateId);
}

/**
 * Compare pinned models against the live image catalog.
 * Returns null when the check could not be made — callers must treat that as
 * "no information", never as "everything is current".
 */
export async function checkStaleness(): Promise<StalenessReport | null> {
  const catalog = await fetchCatalog();
  if (!catalog?.models?.length) return null;

  // Anything we already ship is not a suggestion. We deliberately pin more than
  // one tier of the same provider (a quality model and a speed model), so
  // without this the check would forever advise "upgrade" the speed pin to the
  // quality pin that is already installed alongside it.
  const alreadyPinned = new Set(listModels().map((m) => m.id));

  const suggestions: StalenessSuggestion[] = [];

  for (const pinned of listModels()) {
    const pinnedDate = pinned.releaseDate;
    if (!pinnedDate) continue;

    const newer = catalog.models
      .filter(
        (m) =>
          m.modelId !== pinned.id &&
          !alreadyPinned.has(m.modelId) &&
          (m.provider ?? "").toLowerCase() === pinned.provider &&
          m.status !== "deprecated" &&
          isNewer(m.releaseDate, pinnedDate) &&
          !isTierDowngrade(m.modelId, pinned.id) &&
          isSameKind(m.modelId, pinned.id)
      )
      .sort((a, b) => String(b.releaseDate).localeCompare(String(a.releaseDate)))
      .slice(0, 3);

    if (newer.length) suggestions.push({ pinned, newer });
  }

  return { suggestions, checkedAt: new Date().toISOString() };
}

/** Human-readable advisory. Returns "" when there is nothing to say. */
export function formatReport(report: StalenessReport | null): string {
  if (!report?.suggestions.length) return "";
  const lines = [
    "",
    "Newer image models are available (advisory — nothing was changed):",
  ];
  for (const s of report.suggestions) {
    const names = s.newer.map((n) => `${n.modelId} (${n.releaseDate})`).join(", ");
    lines.push(`  ${s.pinned.label} [${s.pinned.id}] → ${names}`);
  }
  lines.push(
    "  These are not wired up yet. Pinned models are updated with the plugin —",
    "  open an issue or bump the plugin to adopt one."
  );
  return lines.join("\n");
}
