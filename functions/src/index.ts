import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'
import { createHash } from 'node:crypto'
import exifr from 'exifr'
import { initializeApp } from 'firebase-admin/app'
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { defineSecret } from 'firebase-functions/params'
import { logger } from 'firebase-functions'
import sharp from 'sharp'

initializeApp()
const geminiApiKey = defineSecret('GEMINI_API_KEY')

function distanceMetres(a: {lat:number; lng:number}, b: {lat:number; lng:number}) {
  const rad = Math.PI / 180, dLat = (b.lat-a.lat)*rad, dLng = (b.lng-a.lng)*rad
  const h = Math.sin(dLat/2)**2 + Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dLng/2)**2
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1-h))
}

function appleLocation(value: unknown) {
  if (typeof value !== 'string') return null
  const match = value.match(/^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/)
  return match ? { latitude:Number(match[1]), longitude:Number(match[2]) } : null
}

async function processSighting(sightingId: string, imageUrl: string, testerEmail?: string) {
  const db = getFirestore()
  const doc = await db.collection('sightings').doc(sightingId).get()
  if (!doc.exists || doc.data()?.verificationStatus !== 'pending') throw new HttpsError('failed-precondition', 'This report cannot be verified.')
  const response = await fetch(imageUrl)
  if (!response.ok) throw new HttpsError('internal', 'Could not fetch the report image.')
  const bytes = Buffer.from(await response.arrayBuffer())
  logger.info('verifySighting:image-fetched', { sightingId, bytes: bytes.length })
  if (bytes.length > 20 * 1024 * 1024) throw new HttpsError('invalid-argument', 'Image is too large.')
  const data = doc.data()!
  const imageHash = createHash('sha256').update(bytes).digest('hex')
  const duplicate = await db.collection('sightings').where('imageHash', '==', imageHash).limit(1).get()
  if (!duplicate.empty) {
    await doc.ref.update({ imageUrl, imageHash, verificationStatus: 'rejected', aiReason: 'This exact image was already submitted.', verifiedAt: FieldValue.serverTimestamp() })
    return { approved: false, reason: 'This exact image was already submitted.', locationEvidence: 'duplicate' }
  }
  let metadata: { latitude?:number; longitude?:number; DateTimeOriginal?:Date; CreateDate?:Date } = {}
  try {
    const [gps, dates, full] = await Promise.all([
      exifr.gps(bytes),
      exifr.parse(bytes, ['DateTimeOriginal', 'CreateDate']),
      exifr.parse(bytes, { gps:true, exif:true, xmp:true, reviveValues:true }),
    ])
    const appleGps = appleLocation(full?.GPSCoordinates || full?.location || full?.Location || full?.['com.apple.quicktime.location.ISO6709'])
    metadata = { ...(dates || {}), ...(full || {}), ...(appleGps || {}), ...(gps || {}) }
  } catch (error) { logger.warn('verifySighting:exif-parse-failed', { sightingId, error:error instanceof Error?error.message:String(error) }) }
  const hasGps = Number.isFinite(metadata.latitude) && Number.isFinite(metadata.longitude)
  const photoDistance = hasGps ? distanceMetres({ lat: data.lat, lng: data.lng }, { lat: metadata.latitude!, lng: metadata.longitude! }) : null
  const capturedAt = metadata.DateTimeOriginal || metadata.CreateDate
  const ageMs = capturedAt ? Date.now() - new Date(capturedAt).getTime() : null
  const submittedAgoMs = data.createdAt?.toMillis ? Date.now() - data.createdAt.toMillis() : null
  const liveCamera = data.photoSource === 'camera' && submittedAgoMs !== null && submittedAgoMs >= 0 && submittedAgoMs <= 10*60*1000
  const locationEvidence = !hasGps ? liveCamera ? 'live-camera' : 'unverified' : photoDistance! <= 200 ? 'verified' : 'mismatch'
  const timeEvidence = ageMs === null ? liveCamera ? 'recent' : 'unverified' : ageMs >= -10*60*1000 && ageMs <= 24*60*60*1000 ? 'recent' : 'stale'
  logger.info('verifySighting:metadata-checked', { sightingId, locationEvidence, timeEvidence, photoDistance })
  let analysisBytes: Buffer<ArrayBufferLike> = bytes
  let analysisMime = response.headers.get('content-type') || 'image/jpeg'
  try {
    analysisBytes = await sharp(bytes).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer()
    analysisMime = 'image/jpeg'
  } catch (error) { logger.warn('verifySighting:image-resize-skipped', { sightingId, error: error instanceof Error ? error.message : String(error) }) }
  logger.info('verifySighting:gemini-start', { sightingId, analysisBytes: analysisBytes.length })
  const model = new GoogleGenerativeAI(geminiApiKey.value()).getGenerativeModel({
    model: 'gemini-3.6-flash',
    generationConfig: { responseMimeType: 'application/json', responseSchema: { type: SchemaType.OBJECT, properties: {
      containsDog: { type: SchemaType.BOOLEAN }, plausible: { type: SchemaType.BOOLEAN }, manipulationLikely: { type: SchemaType.BOOLEAN }, testCodeDetected: { type: SchemaType.BOOLEAN }, confidence: { type: SchemaType.NUMBER }, dogCount: { type: SchemaType.INTEGER }, observedSeverity: { type: SchemaType.STRING, format: 'enum', enum: ['low','medium','high'] }, observedBehavior: { type: SchemaType.STRING, format: 'enum', enum: ['calm','roaming','barking','chasing','aggressive','injured','unknown'] }, sceneSummary: { type: SchemaType.STRING }, reason: { type: SchemaType.STRING }
    }, required: ['containsDog','plausible','manipulationLikely','testCodeDetected','confidence','dogCount','observedSeverity','observedBehavior','sceneSummary','reason'] } }
  })
  let result
  try {
    result = await model.generateContent([
      `Act as a conservative safety-report verifier. Check whether the image visibly contains one or more real dogs and is broadly consistent with this report: "${String(data.description).slice(0,500)}". Detect screenshots, memes, AI-generated imagery, obvious edits, or reused media as manipulationLikely. Set testCodeDetected true only if the exact standalone word "nirmal" is visibly written in the image. Do not infer aggression from breed. You cannot verify geographic coordinates from appearance alone; location is checked separately from EXIF. sceneSummary should concisely describe dog count, behavior, and surroundings without inventing facts. Keep reason under 120 characters.`,
      { inlineData: { data: analysisBytes.toString('base64'), mimeType: analysisMime } }
    ])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('verifySighting:gemini-failed', { sightingId, message })
    await doc.ref.update({ imageUrl, imageHash, verificationStatus: 'rejected', aiReason: 'AI verification service failed. Please submit again.', verifiedAt: FieldValue.serverTimestamp() })
    throw new HttpsError('internal', 'AI verification failed. Please submit again.')
  }
  logger.info('verifySighting:gemini-complete', { sightingId })
  const verdict = JSON.parse(result.response.text()) as { containsDog:boolean; plausible:boolean; manipulationLikely:boolean; testCodeDetected:boolean; confidence:number; dogCount:number; observedSeverity:'low'|'medium'|'high'; observedBehavior:string; sceneSummary:string; reason:string }
  const authorizedTester = testerEmail === 'nirmalnpatel54321@gmail.com'
  const testOverride = authorizedTester && verdict.testCodeDetected
  const approved = testOverride || (verdict.containsDog && verdict.plausible && !verdict.manipulationLikely && verdict.confidence >= 0.65 && (locationEvidence === 'verified' || locationEvidence === 'live-camera') && timeEvidence === 'recent')
  const reason = testOverride ? 'Authorized developer test code accepted.' : locationEvidence === 'mismatch' ? `Photo location is ${Math.round(photoDistance!)} m from this report.` : locationEvidence === 'unverified' ? 'Photo has no GPS metadata, so its location cannot be verified.' : timeEvidence === 'stale' ? 'Photo was not captured within the last 24 hours.' : verdict.reason
  await doc.ref.update({ imageUrl, imageHash, verificationStatus: approved ? 'approved' : 'rejected', testOnly: testOverride, aiReason: reason, aiSummary: verdict.sceneSummary, aiConfidence: verdict.confidence, dogCount: Math.max(1, verdict.dogCount), severity: approved ? verdict.observedSeverity : data.severity, observedBehavior: verdict.observedBehavior, locationEvidence: testOverride ? 'developer-override' : locationEvidence, photoDistanceMetres: photoDistance, timeEvidence, photoCapturedAt: capturedAt || null, manipulationLikely: verdict.manipulationLikely, verifiedAt: FieldValue.serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000) })
  logger.info('verifySighting:complete', { sightingId, approved, testOverride })
  return { approved, reason, locationEvidence: testOverride ? 'developer-override' : locationEvidence, testOnly: testOverride }
}

export const verifySighting = onCall({ region: 'asia-south1', secrets: [geminiApiKey], enforceAppCheck: false, timeoutSeconds: 180, memory: '512MiB' }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before submitting a report.')
  const sightingId = String(request.data?.sightingId || '')
  const imageUrl = String(request.data?.imageUrl || '')
  if (!sightingId || !imageUrl.startsWith('https://')) throw new HttpsError('invalid-argument', 'Missing report or image.')
  const doc = await getFirestore().collection('sightings').doc(sightingId).get()
  if (!doc.exists || doc.data()?.reporterId !== request.auth.uid) throw new HttpsError('permission-denied', 'This report cannot be verified.')
  return processSighting(sightingId, imageUrl, request.auth.token.email as string | undefined)
})

export const processPendingSighting = onDocumentUpdated({ document: 'sightings/{sightingId}', region: 'asia-south1', secrets: [geminiApiKey], timeoutSeconds: 180, memory: '512MiB' }, async event => {
  const before = event.data?.before.data(), after = event.data?.after.data()
  if (!after || after.verificationStatus !== 'pending' || !after.imageUrl || before?.imageUrl === after.imageUrl || after.processingStatus === 'processing') return
  const ref = event.data!.after.ref
  await ref.update({ processingStatus: 'processing', processingStartedAt: FieldValue.serverTimestamp() })
  try {
    await processSighting(event.params.sightingId, after.imageUrl, after.reporterEmail)
  } catch (error) {
    logger.error('processPendingSighting:failed', { sightingId:event.params.sightingId, error:error instanceof Error?error.message:String(error) })
    await ref.update({ verificationStatus:'rejected', processingStatus:'failed', aiReason:'Verification could not be completed. Please submit again.', verifiedAt:FieldValue.serverTimestamp() })
  }
})
