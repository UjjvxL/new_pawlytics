export type Severity = 'low' | 'medium' | 'high'
export type VerificationStatus = 'uploading' | 'automated_review' | 'provisional' | 'review_required' | 'confirmed' | 'rejected' | 'duplicate' | 'expired' | 'removed' | 'appealed' | 'pending' | 'approved'
export type AuthorityRole = 'moderator' | 'dispatcher' | 'field_officer' | 'analyst' | 'org_admin' | 'platform_admin'
export type TrustTier = 'new' | 'contributor' | 'trusted' | 'guardian'

export interface Sighting {
  id: string
  lat: number
  lng: number
  description: string
  severity: Severity
  dogCount?: number
  imageUrl?: string
  thumbnailUrl?: string
  createdAt?: { toDate: () => Date } | Date
  expiresAt?: { toDate: () => Date } | Date
  verificationStatus: VerificationStatus
  aiReason?: string
  aiSummary?: string
  observedBehavior?: string
  aiConfidence?: number
  locationEvidence?: string
  testOnly?: boolean
  provisional?: boolean
  organizationId?: string
  jurisdictionId?: string
  rewardStatus?: 'ineligible' | 'pending' | 'credited' | 'reversed'
  pointsAwarded?: number
}

export interface UserProfile {
  uid: string
  handle: string
  displayName: string
  photoURL?: string
  city?: string
  language: string
  trustTier: TrustTier
  impactPoints: number
  confirmedReports: number
  currentStreak: number
  phoneVerified: boolean
  communityVisible: boolean
  leaderboardVisible: boolean
  onboardingComplete: boolean
  contributionStatus: 'active' | 'limited' | 'suspended'
}

export interface OrganizationMembership {
  organizationId: string
  uid: string
  role: AuthorityRole
  jurisdictionIds: string[]
  status: 'invited' | 'active' | 'suspended'
  mfaRequired: boolean
}

export interface ReviewCase {
  id: string
  reportId: string
  organizationId?: string
  priority: 'normal' | 'high' | 'critical'
  status: 'open' | 'assigned' | 'resolved' | 'appealed'
  reasonCodes: string[]
  assignedTo?: string
}
