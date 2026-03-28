import { evaluateSmsPayload } from '../../server/api.js'
import { errorResponse, jsonResponse } from '../_utils.js'

export async function POST() {
  try {
    return jsonResponse(await evaluateSmsPayload())
  } catch (error) {
    return errorResponse(error, {
      status: 500,
      body: {
        message: 'Unable to evaluate BayGuard SMS alerts right now.',
      },
    })
  }
}
