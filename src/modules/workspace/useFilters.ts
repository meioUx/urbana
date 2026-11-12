import { useState } from "react";

/** Filtros compartilhados pelas listas de ocorrências, triagem, ordens e mapa. */
export function useFilters() {
  const [q, setQ] = useState(""),
    [status, setStatus] = useState(""),
    [priority, setPriority] = useState(""),
    [team, setTeam] = useState(""),
    [deadline, setDeadline] = useState(""),
    [category, setCategory] = useState(""),
    [neighborhood, setNeighborhood] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  return {
    q,
    setQ,
    status,
    setStatus,
    priority,
    setPriority,
    team,
    setTeam,
    deadline,
    setDeadline,
    category,
    setCategory,
    neighborhood,
    setNeighborhood,
    from,
    setFrom,
    to,
    setTo,
  };
}

export type Filters = ReturnType<typeof useFilters>;
