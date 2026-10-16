export async function postRpc<T>(
  endpoint: string,
  method: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch(endpoint, {
    body: JSON.stringify({ method, payload }),
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const body = (await response.json()) as {
    message?: string;
    ok?: boolean;
    result?: T;
  };
  if (!response.ok || !body.ok) {
    throw new Error(body.message || "Không xử lý được yêu cầu.");
  }
  return body.result as T;
}
