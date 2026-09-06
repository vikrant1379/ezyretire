export async function readAuthResponse<T>(response: Response): Promise<T> {
  const rawBody = await response.text();

  if (!rawBody.trim()) {
    throw new Error("The sign-in service returned an empty response. Please try again.");
  }

  try {
    return JSON.parse(rawBody) as T;
  } catch {
    throw new Error("The sign-in service returned an invalid response. Please try again.");
  }
}