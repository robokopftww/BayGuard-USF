import { verifyPayload } from '../server/api'
import { errorResponse, jsonResponse, readJsonBody } from './_utils'

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request)
    return jsonResponse(await verifyPayload(body))
  } catch (error) {
    return errorResponse(error, {
      status: 500,
      body: {
        error: 'Verification failed',
      },
    })
  }
}
