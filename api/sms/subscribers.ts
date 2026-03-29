import { createSmsSubscriberPayload, deleteSmsSubscriberPayload } from '../../server/api.js'
import { errorResponse, jsonResponse, readJsonBody } from '../_utils.js'

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

export async function DELETE(request: Request) {
  try {
    const subscriberId = new URL(request.url).searchParams.get('id')
    return jsonResponse(await deleteSmsSubscriberPayload({ id: subscriberId }))
  } catch (error) {
    return errorResponse(error, {
      status: 404,
      body: {
        message: 'Subscriber not found.',
      },
    })
  }
}
