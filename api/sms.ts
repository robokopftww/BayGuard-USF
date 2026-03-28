import { getSmsPayload } from '../server/api'
import { errorResponse, jsonResponse } from './_utils'

export async function GET() {
  try {
    return jsonResponse(await getSmsPayload())
  } catch (error) {
    return errorResponse(error, {
      status: 500,
      body: {
        message: 'Unable to load the SMS control room right now.',
      },
    })
  }
}
