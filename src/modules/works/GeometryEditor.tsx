import { useId, useMemo, useState } from "react";
import {
  normalizeGeometry,
  geometryBBox,
  type Geometry,
  type Position,
} from "../../../shared/geometry.mjs";
import { GeoMap } from "../map/LazyGeoMap";
import type { MapOverlay } from "../map/GeoMap";
import { describeGeometry, featureStyle } from "./model";

export type DrawKind = "Point" | "LineString" | "Polygon";

/** Pontos editáveis a partir de uma geometria salva (várias linhas são editadas como a primeira). */
export function verticesOf(g?: Geometry | null): {
  kind: DrawKind;
  points: Position[];
} {
  if (!g) return { kind: "LineString", points: [] };
  if (g.type === "Point") return { kind: "Point", points: [g.coordinates] };
  if (g.type === "Polygon")
    return { kind: "Polygon", points: g.coordinates[0].slice(0, -1) };
  if (g.type === "MultiLineString")
    return { kind: "LineString", points: g.coordinates.flat() };
  return { kind: "LineString", points: g.coordinates };
}
/** GeoJSON a partir dos pontos desenhados; null enquanto faltarem pontos. Lança GeometryError se inválida. */
export function buildGeometry(
  kind: DrawKind,
  points: Position[],
): Geometry | null {
  if (kind === "Point")
    return points.length
      ? normalizeGeometry({ type: "Point", coordinates: points.at(-1) })
      : null;
  if (kind === "LineString")
    return points.length >= 2
      ? normalizeGeometry({ type: "LineString", coordinates: points })
      : null;
  return points.length >= 3
    ? normalizeGeometry({
        type: "Polygon",
        coordinates: [[...points, points[0]]],
      })
    : null;
}

/**
 * Desenho da geometria por cliques no mapa (ponto, linha ou polígono), com alternativa sem mapa:
 * lista de pontos com remoção e inclusão por coordenadas digitadas. Anuncia o resultado em aria-live.
 */
export default function GeometryEditor({
  initial,
  onChange,
}: {
  initial?: Geometry | null;
  onChange: (geometry: Geometry | null, error: string) => void;
}) {
  const start = useMemo(() => verticesOf(initial), []); // eslint-disable-line react-hooks/exhaustive-deps -- valor inicial
  const [kind, setKind] = useState<DrawKind>(start.kind);
  const [points, setPoints] = useState<Position[]>(start.points);
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [inputError, setInputError] = useState("");
  const name = useId();
  const result = useMemo(() => {
    try {
      return { geometry: buildGeometry(kind, points), error: "" };
    } catch (e: any) {
      return { geometry: null, error: e.message as string };
    }
  }, [kind, points]);
  const update = (nextKind: DrawKind, nextPoints: Position[]) => {
    setKind(nextKind);
    setPoints(nextPoints);
    let geometry: Geometry | null = null,
      error = "";
    try {
      geometry = buildGeometry(nextKind, nextPoints);
    } catch (e: any) {
      error = e.message;
    }
    onChange(geometry, error);
  };
  const add = (p: Position) =>
    update(kind, kind === "Point" ? [p] : [...points, p]);
  const overlays = useMemo<MapOverlay[]>(() => {
    const features: any[] = [];
    if (result.geometry)
      features.push({
        type: "Feature",
        properties: { kind: "shape" },
        geometry: result.geometry,
      });
    if (kind !== "Point")
      for (const p of points)
        features.push({
          type: "Feature",
          properties: { kind: "vertex" },
          geometry: { type: "Point", coordinates: p },
        });
    if (kind === "LineString" && points.length === 1)
      features.push({
        type: "Feature",
        properties: { kind: "vertex" },
        geometry: { type: "Point", coordinates: points[0] },
      });
    return [
      {
        id: "draft",
        data: { type: "FeatureCollection", features } as any,
        options: {
          interactive: false,
          style: (f: any) =>
            (f?.properties?.kind === "vertex"
              ? {
                  radius: 5,
                  color: "#fff",
                  weight: 2,
                  fillColor: "#1f7fb8",
                  fillOpacity: 1,
                }
              : featureStyle("EM_ANDAMENTO", true)) as any,
        },
      },
    ];
  }, [result.geometry, points, kind]);
  const [fit] = useState(() => (initial ? geometryBBox(initial) : null));
  const status = result.error
    ? result.error
    : result.geometry
      ? describeGeometry(result.geometry)
      : kind === "Point"
        ? "Nenhum ponto marcado."
        : `${points.length} ${points.length === 1 ? "ponto marcado" : "pontos marcados"}; ${kind === "LineString" ? "a linha precisa de ao menos dois" : "o polígono precisa de ao menos três"}.`;
  return (
    <fieldset className="geometry-editor">
      <legend>Geometria da intervenção</legend>
      <div
        className="geometry-kinds"
        role="radiogroup"
        aria-label="Tipo de geometria"
      >
        {(
          [
            ["Point", "Ponto (ativo)"],
            ["LineString", "Linha (trecho)"],
            ["Polygon", "Polígono (área)"],
          ] as [DrawKind, string][]
        ).map(([value, label]) => (
          <label key={value}>
            <input
              type="radio"
              name={name}
              value={value}
              checked={kind === value}
              onChange={() =>
                update(value, value === "Point" ? points.slice(-1) : points)
              }
            />
            {label}
          </label>
        ))}
      </div>
      <p className="muted geometry-help">
        Clique no mapa para{" "}
        {kind === "Point"
          ? "marcar o ponto"
          : "acrescentar pontos na ordem do traçado"}
        {kind === "Polygon" ? "; o contorno é fechado automaticamente" : ""}.
        Sem usar o mapa, informe latitude e longitude abaixo.
      </p>
      <div className="geometry-map">
        <GeoMap
          rows={[]}
          pick={(la, ln) =>
            add([Math.round(ln * 1e7) / 1e7, Math.round(la * 1e7) / 1e7])
          }
          overlays={overlays}
          fit={fit}
        />
      </div>
      <p
        className={result.error ? "form-error" : "geometry-status"}
        role="status"
        aria-live="polite"
      >
        {status}
      </p>
      <div className="geometry-actions">
        <button
          type="button"
          className="button secondary"
          disabled={!points.length}
          onClick={() => update(kind, points.slice(0, -1))}
        >
          Desfazer último ponto
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={!points.length}
          onClick={() => update(kind, [])}
        >
          Limpar desenho
        </button>
      </div>
      <div className="geometry-manual">
        <label className="field">
          <span>Latitude</span>
          <input
            inputMode="decimal"
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            placeholder="-26,9900"
          />
        </label>
        <label className="field">
          <span>Longitude</span>
          <input
            inputMode="decimal"
            value={lng}
            onChange={(e) => setLng(e.target.value)}
            placeholder="-48,6400"
          />
        </label>
        <button
          type="button"
          className="button secondary"
          onClick={() => {
            const la = Number(lat.replace(",", ".")),
              ln = Number(lng.replace(",", "."));
            if (
              !lat.trim() ||
              !lng.trim() ||
              !Number.isFinite(la) ||
              !Number.isFinite(ln) ||
              Math.abs(la) > 90 ||
              Math.abs(ln) > 180
            ) {
              setInputError(
                "Informe latitude (−90 a 90) e longitude (−180 a 180) válidas.",
              );
              return;
            }
            setInputError("");
            add([ln, la]);
            setLat("");
            setLng("");
          }}
        >
          Adicionar ponto
        </button>
      </div>
      {inputError && (
        <p className="form-error" role="alert">
          {inputError}
        </p>
      )}
      {points.length > 0 && (
        <ol className="geometry-points" aria-label="Pontos da geometria">
          {points.map((p, i) => (
            <li key={`${i}-${p.join(",")}`}>
              <span>
                Ponto {i + 1}: latitude{" "}
                {p[1].toLocaleString("pt-BR", { maximumFractionDigits: 6 })},
                longitude{" "}
                {p[0].toLocaleString("pt-BR", { maximumFractionDigits: 6 })}
              </span>
              <button
                type="button"
                className="text-button"
                aria-label={`Remover ponto ${i + 1}`}
                onClick={() =>
                  update(
                    kind,
                    points.filter((_, j) => j !== i),
                  )
                }
              >
                Remover
              </button>
            </li>
          ))}
        </ol>
      )}
    </fieldset>
  );
}
