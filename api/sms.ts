import { getSmsPayload } from '../server/api.ts'
import { errorResponse, jsonResponse } from './_utils.ts'

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
