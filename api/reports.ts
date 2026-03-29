import { createCommunityReportPayload, getCommunityReportsPayload } from '../server/api.js'
import { errorResponse, jsonResponse, readJsonBody } from './_utils.js'

export async function GET() {
  try {
    return jsonResponse(await getCommunityReportsPayload())
  } catch (error) {
    return errorResponse(error, {
      status: 500,
      body: {
        message: 'Unable to load BayGuard community reports right now.',
      },
    })
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request)
    return jsonResponse(await createCommunityReportPayload(body), { status: 201 })
  } catch (error) {
    return errorResponse(error, {
      status: 400,
      body: {
        message: 'Unable to save this community report.',
      },
    })
  }
}
