export async function api(path: string, method = "GET", body?: any) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      signal: controller.signal,
      headers:
        body instanceof FormData
          ? {}
          : body
            ? { "Content-Type": "application/json" }
            : {},
      body:
        body instanceof FormData
          ? body
          : body
            ? JSON.stringify(body)
            : undefined,
    });
  } catch (error: any) {
    if (error?.name === "AbortError")
      throw new Error(
        method === "GET"
          ? "A resposta demorou demais. Tente atualizar novamente."
          : "O servidor não confirmou a operação a tempo. Confira o registro antes de repetir o envio.",
      );
    throw new Error(
      method === "GET"
        ? "Não foi possível comunicar com o servidor. Verifique a conexão e tente novamente."
        : "A conexão foi interrompida. Confira se a operação foi registrada antes de repetir o envio.",
    );
  } finally {
    window.clearTimeout(timeout);
  }
  const data = await res.json().catch(() => ({
    error:
      "O servidor retornou uma resposta inesperada. Confira o registro e atualize a página.",
  }));
  if (res.ok && data.error) throw new Error(data.error);
  if (!res.ok)
    throw Object.assign(new Error(data.error), {
      status: res.status,
      code: data.code,
      details: data.details,
    });
  return data;
}
