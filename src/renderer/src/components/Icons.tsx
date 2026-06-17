import type { JSX } from 'react'

type P = { size?: number; className?: string }

function S({ size = 16, className, children }: P & { children: JSX.Element | JSX.Element[] }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {children}
    </svg>
  )
}

export const IconDashboard = (p: P) => (
  <S {...p}>
    <>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </>
  </S>
)
export const IconCampaigns = (p: P) => (
  <S {...p}>
    <>
      <path d="M3 7h18" />
      <path d="M3 12h18" />
      <path d="M3 17h12" />
    </>
  </S>
)
export const IconBeaker = (p: P) => (
  <S {...p}>
    <>
      <path d="M9 3h6" />
      <path d="M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9V3" />
      <path d="M7.5 14h9" />
    </>
  </S>
)
export const IconTournament = (p: P) => (
  <S {...p}>
    <>
      <path d="M6 4v6a6 6 0 0 0 12 0V4" />
      <path d="M4 4h16" />
      <path d="M12 16v4" />
      <path d="M8 20h8" />
    </>
  </S>
)
export const IconGraph = (p: P) => (
  <S {...p}>
    <>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="8" r="2.5" />
      <circle cx="9" cy="18" r="2.5" />
      <path d="M8 7.5 15.5 8M8 16 16 9.5" />
    </>
  </S>
)
export const IconOverview = (p: P) => (
  <S {...p}>
    <>
      <path d="M4 4h16v16H4z" />
      <path d="M8 9h8M8 13h8M8 17h5" />
    </>
  </S>
)
export const IconExpert = (p: P) => (
  <S {...p}>
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" />
    </>
  </S>
)
export const IconSettings = (p: P) => (
  <S {...p}>
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
    </>
  </S>
)
export const IconLog = (p: P) => (
  <S {...p}>
    <>
      <path d="M5 3h10l4 4v14H5z" />
      <path d="M14 3v4h4" />
      <path d="M8 13h8M8 17h6" />
    </>
  </S>
)
export const IconPlay = (p: P) => (
  <S {...p}>
    <path d="M7 4l13 8-13 8z" />
  </S>
)
export const IconPause = (p: P) => (
  <S {...p}>
    <>
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </>
  </S>
)
export const IconStop = (p: P) => (
  <S {...p}>
    <rect x="6" y="6" width="12" height="12" rx="1.5" />
  </S>
)
export const IconPlus = (p: P) => (
  <S {...p}>
    <path d="M12 5v14M5 12h14" />
  </S>
)
export const IconClose = (p: P) => (
  <S {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </S>
)
export const IconFlag = (p: P) => (
  <S {...p}>
    <>
      <path d="M5 21V4" />
      <path d="M5 4h12l-2 4 2 4H5" />
    </>
  </S>
)
export const IconChevron = (p: P) => (
  <S {...p}>
    <path d="M9 6l6 6-6 6" />
  </S>
)
export const IconTrash = (p: P) => (
  <S {...p}>
    <>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
    </>
  </S>
)
export const IconCheck = (p: P) => (
  <S {...p}>
    <path d="M5 13l4 4L19 7" />
  </S>
)
export const IconRefresh = (p: P) => (
  <S {...p}>
    <>
      <path d="M4 12a8 8 0 0 1 14-5l2 2" />
      <path d="M20 12a8 8 0 0 1-14 5l-2-2" />
      <path d="M18 4v5h-5M6 20v-5h5" />
    </>
  </S>
)

export const IconDownload = (p: P) => (
  <S {...p}>
    <>
      <path d="M12 3v12" />
      <path d="M7 11l5 5 5-5" />
      <path d="M5 21h14" />
    </>
  </S>
)
