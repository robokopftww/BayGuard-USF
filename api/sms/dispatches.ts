import { deleteSmsDispatchPayload } from '../../server/api.js'
import { errorResponse, jsonResponse } from '../_utils.js'

export async function DELETE(request: Request) {
  try {
    const dispatchId = new URL(request.url).searchParams.get('id')
    return jsonResponse(await deleteSmsDispatchPayload({ id: dispatchId }))
  } catch (error) {
    return errorResponse(error, {
      status: 404,
      body: {
        message: 'Text alert not found.',
      },
    })
  }
}
