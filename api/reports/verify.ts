import { reverifyCommunityReportPayload } from '../../server/api.js'
import { errorResponse, jsonResponse, readJsonBody } from '../_utils.js'

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request)
    return jsonResponse(await reverifyCommunityReportPayload(body))
  } catch (error) {
    return errorResponse(error, {
      status: 404,
      body: {
        message: 'Unable to re-check this community report.',
      },
    })
  }
}
