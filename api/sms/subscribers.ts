import { createSmsSubscriberPayload } from '../../server/api.ts'
import { errorResponse, jsonResponse, readJsonBody } from '../_utils.ts'

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request)
    const payload = await createSmsSubscriberPayload(body)
    return jsonResponse(payload, { status: 201 })
  } catch (error) {
    return errorResponse(error, {
      status: 400,
      body: {
        message: 'Unable to save this SMS subscriber.',
      },
    })
  }
}
