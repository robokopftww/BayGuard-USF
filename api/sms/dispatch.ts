import { dispatchSmsPayload } from '../../server/api.ts'
import { errorResponse, jsonResponse, readJsonBody } from '../_utils.ts'

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request)
    return jsonResponse(await dispatchSmsPayload(body))
  } catch (error) {
    return errorResponse(error, {
      status: 500,
      body: {
        message: 'Unable to dispatch BayGuard SMS alerts right now.',
      },
    })
  }
}
