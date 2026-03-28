import { evacuatePayload } from '../server/api.ts'
import { errorResponse, jsonResponse, readJsonBody } from './_utils.ts'

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request)
    return jsonResponse(await evacuatePayload(body))
  } catch (error) {
    return errorResponse(error, {
      status: 500,
      body: {
        error: 'Could not generate evacuation plan',
      },
    })
  }
}
