import React, { useId, useRef, useState } from "react";
import "./address-search.css";

export type AddressResult = { address: string; neighborhood: string; lat: number; lng: number };

export default function AddressSearch({ onSelect, disabled = false }: {
  onSelect: (result: AddressResult) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const request = useRef(0);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AddressResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const search = async () => {
    if (busy || disabled || query.trim().length < 3) return;
    const current = ++request.current;
    setBusy(true);
    setMessage("");
    setResults([]);
    try {
      const url = new URL("https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates");
      url.search = new URLSearchParams({
        f: "json", SingleLine: query.trim(), sourceCountry: "BRA",
        outFields: "StAddr,Neighborhood,District,City,Region", outSR: "4326",
        maxLocations: "5", location: "-48.638,-26.998"
      }).toString();
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error();
      const body = await response.json();
      if (body.error || !Array.isArray(body.candidates)) throw new Error();
      const found = body.candidates.filter((c: any) =>
        typeof c.address === "string" && Number.isFinite(c.location?.x) &&
        Number.isFinite(c.location?.y) && Math.abs(c.location.y) <= 90 &&
        Math.abs(c.location.x) <= 180
      ).map((c: any) => ({
        address: c.address,
        neighborhood: c.attributes?.Neighborhood || c.attributes?.District || "",
        lat: c.location.y, lng: c.location.x
      }));
      if (current !== request.current) return;
      setResults(found);
      setMessage(found.length ? "Selecione o endereço correto e confira o local." : "Nenhum endereço encontrado. Inclua a cidade e o número ou ajuste a busca.");
    } catch {
      if (current === request.current)
        setMessage("Não foi possível buscar o endereço. Verifique a conexão e tente novamente. Você também pode usar o GPS ou informar o local manualmente.");
    } finally {
      if (current === request.current) setBusy(false);
    }
  };
  return <div className="address-search" aria-busy={busy}>
    <label htmlFor={id}>Buscar endereço</label>
    <div className="address-search-controls">
      <input id={id} type="search" maxLength={300} value={query} disabled={disabled}
        placeholder="Rua, número e cidade"
        onChange={e => { ++request.current; setBusy(false); setQuery(e.target.value); setResults([]); setMessage(""); }}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); void search(); } }} />
      <button type="button" disabled={disabled || busy || query.trim().length < 3} onClick={search}>
        {busy ? "Buscando..." : "Buscar endereço"}
      </button>
    </div>
    <small>Inclua a cidade para refinar a busca. Requer internet.</small>
    {message && <p role="status">{message}</p>}
    {results.length > 0 && <ul aria-label="Endereços encontrados">
      {results.map((r, i) => <li key={i}><button type="button" disabled={disabled} onClick={() => {
        onSelect(r); setQuery(r.address); setResults([]);
        setMessage("Endereço selecionado. Confira o ponto e complete o bairro, se necessário.");
      }}>{r.address}</button></li>)}
    </ul>}
  </div>;
}
