import { unsubscribeSmsSubscriberPayload } from '../../server/api.ts'
import { errorResponse, jsonResponse, readJsonBody } from '../_utils.ts'

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request)
    const payload = await unsubscribeSmsSubscriberPayload(body.id)
    return jsonResponse(payload)
  } catch (error) {
    return errorResponse(error, {
      status: 404,
      body: {
        message: 'Subscriber not found.',
      },
    })
  }
}
