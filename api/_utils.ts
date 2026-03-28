import { ApiError } from '../server/api'

export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json()
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init)
}

export function errorResponse(error: unknown, fallback: { status: number; body: unknown }): Response {
  if (error instanceof ApiError) {
    return jsonResponse(error.payload, { status: error.status })
  }

  const details =
    error instanceof Error && typeof fallback.body === 'object' && fallback.body !== null
      ? { ...fallback.body, details: error.message }
      : fallback.body

  return jsonResponse(details, { status: fallback.status })
}
