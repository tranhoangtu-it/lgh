/**
 * src/features/prs/detail.jsx — PR detail pane
 */

import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { format } from 'timeago.js'
import { useGh } from '../../hooks/useGh.js'
import { getPR } from '../../executor.js'
import { FooterKeys } from '../../components/FooterKeys.jsx'
import { t } from '../../theme.js'

function reviewStatusIcon(state) {
  switch (state) {
    case 'APPROVED': return { icon: '✓', color: t.ci.pass }
    case 'CHANGES_REQUESTED': return { icon: '✗', color: t.ci.fail }
    case 'COMMENTED': return { icon: '●', color: t.ui.muted }
    default: return { icon: '○', color: t.ui.dim }
  }
}

function prStateBadge(pr) {
  if (pr.isDraft) return { icon: '⊘', color: t.pr.draft, label: 'Draft' }
  switch (pr.state) {
    case 'OPEN': return { icon: '●', color: t.pr.open, label: 'Open' }
    case 'MERGED': return { icon: '✓', color: t.pr.merged, label: 'Merged' }
    case 'CLOSED': return { icon: '✗', color: t.pr.closed, label: 'Closed' }
    default: return { icon: '?', color: t.ui.muted, label: pr.state }
  }
}

const FOOTER_KEYS = [
  { key: 'd', label: 'diff' },
  { key: 'Esc', label: 'back' },
  { key: 'r', label: 'refresh' },
]

export function PRDetail({ prNumber, repo, onBack, onOpenDiff }) {
  const { data: pr, loading, error, refetch } = useGh(getPR, [repo, prNumber])
  const [bodyExpanded, setBodyExpanded] = useState(false)

  useInput((input, key) => {
    if (input === 'r') { refetch(); return }
    if (input === 'd' && pr) { onOpenDiff(pr); return }
    if (key.escape || input === 'q') { onBack(); return }
    if (key.return && !bodyExpanded) { setBodyExpanded(true); return }
  })

  if (loading) {
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <Text color={t.ui.muted}>Loading PR details...</Text>
      </Box>
    )
  }

  if (error) {
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <Text color={t.ci.fail}>⚠ Failed to load — r to retry</Text>
        <Text color={t.ui.dim}>{error.message}</Text>
      </Box>
    )
  }

  if (!pr) return null

  const badge = prStateBadge(pr)
  const bodyLines = (pr.body || '').split('\n')
  const displayBody = bodyExpanded ? bodyLines : bodyLines.slice(0, 8)

  // Count checks
  const checks = pr.statusCheckRollup || []
  const passing = checks.filter(c => /success/i.test(c.state || c.conclusion || '')).length
  const failing = checks.filter(c => /failure|error/i.test(c.state || c.conclusion || '')).length
  const pending = checks.filter(c => /pending|in_progress/i.test(c.state || c.conclusion || '')).length

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {/* Header */}
      <Box marginBottom={1} flexDirection="column">
        <Box gap={1}>
          <Text color={badge.color}>{badge.icon}</Text>
          <Text bold color={t.ui.selected} wrap="truncate">#{pr.number} {pr.title}</Text>
        </Box>
        <Box gap={2}>
          <Text color={t.ui.muted}>by {pr.author?.login}</Text>
          <Text color={t.ui.dim}>{format(pr.updatedAt)}</Text>
          <Text color={t.ui.muted}>{pr.headRefName} → {pr.baseRefName}</Text>
        </Box>
      </Box>

      {/* Labels */}
      {pr.labels?.length > 0 && (
        <Box marginBottom={1} gap={1}>
          {pr.labels.map(l => (
            <Box key={l.name} paddingX={1} borderStyle="round" borderColor={`#${l.color}`}>
              <Text color={`#${l.color}`}>{l.name}</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Reviewers */}
      {pr.reviews?.length > 0 && (
        <Box marginBottom={1} flexDirection="column">
          <Text color={t.ui.muted} bold>Reviewers:</Text>
          {pr.reviews.map((r, i) => {
            const rs = reviewStatusIcon(r.state)
            return (
              <Box key={i} gap={1}>
                <Text color={rs.color}>{rs.icon}</Text>
                <Text color={t.ui.muted}>{r.author?.login}</Text>
              </Box>
            )
          })}
        </Box>
      )}

      {/* CI */}
      {checks.length > 0 && (
        <Box marginBottom={1} gap={2}>
          <Text color={t.ui.muted}>CI:</Text>
          {passing > 0 && <Text color={t.ci.pass}>✓ {passing}</Text>}
          {failing > 0 && <Text color={t.ci.fail}>✗ {failing}</Text>}
          {pending > 0 && <Text color={t.ci.pending}>● {pending}</Text>}
        </Box>
      )}

      {/* Stats */}
      <Box marginBottom={1} gap={2}>
        <Text color={t.ci.pass}>+{pr.additions || 0}</Text>
        <Text color={t.ci.fail}>-{pr.deletions || 0}</Text>
        <Text color={t.ui.muted}>{pr.changedFiles || 0} files</Text>
      </Box>

      {/* Body */}
      {pr.body && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={t.ui.muted} bold>Description:</Text>
          <Box flexDirection="column" borderStyle="single" borderColor={t.ui.border} paddingX={1}>
            {displayBody.map((line, i) => (
              <Text key={i} color={t.diff.ctxFg} wrap="truncate">{line || ' '}</Text>
            ))}
            {!bodyExpanded && bodyLines.length > 8 && (
              <Text color={t.ui.dim}>[Enter] expand ({bodyLines.length - 8} more lines)</Text>
            )}
          </Box>
        </Box>
      )}

      <FooterKeys keys={FOOTER_KEYS} />
    </Box>
  )
}
