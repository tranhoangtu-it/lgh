/**
 * src/features/prs/diff.jsx — PR diff view with line comments
 */

import React, { useState, useMemo, useEffect } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import chalk from 'chalk'
import { useGh } from '../../hooks/useGh.js'
import { getPRDiff, listPRComments, addPRLineComment } from '../../executor.js'
import { OptionPicker } from '../../components/dialogs/OptionPicker.jsx'
import { FooterKeys } from '../../components/FooterKeys.jsx'
import { t } from '../../theme.js'

// ─── Diff parser ──────────────────────────────────────────────────────────────

function parseDiff(diffText) {
  if (!diffText) return []
  const files = []
  let currentFile = null
  let oldLine = 0
  let newLine = 0

  const lines = diffText.split('\n')
  for (const raw of lines) {
    if (raw.startsWith('diff --git')) {
      currentFile = { header: raw, filename: '', addCount: 0, delCount: 0, lines: [] }
      files.push(currentFile)
      oldLine = 0
      newLine = 0
    } else if (raw.startsWith('--- ')) {
      // ignore
    } else if (raw.startsWith('+++ ') && currentFile) {
      currentFile.filename = raw.slice(4).replace(/^b\//, '')
    } else if (raw.startsWith('@@') && currentFile) {
      const m = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (m) {
        oldLine = parseInt(m[1], 10)
        newLine = parseInt(m[2], 10)
      }
      currentFile.lines.push({ type: 'hunk', text: raw, oldLine: null, newLine: null })
    } else if (currentFile) {
      if (raw.startsWith('+')) {
        currentFile.lines.push({ type: 'add', text: raw.slice(1), oldLine: null, newLine: newLine++ })
        currentFile.addCount++
      } else if (raw.startsWith('-')) {
        currentFile.lines.push({ type: 'del', text: raw.slice(1), oldLine: oldLine++, newLine: null })
        currentFile.delCount++
      } else {
        currentFile.lines.push({ type: 'ctx', text: raw.startsWith(' ') ? raw.slice(1) : raw, oldLine: oldLine++, newLine: newLine++ })
      }
    }
  }
  return files
}

function flattenFiles(files) {
  const rows = []
  for (const file of files) {
    rows.push({ type: 'file-header', filename: file.filename, addCount: file.addCount, delCount: file.delCount })
    for (const line of file.lines) {
      rows.push({ ...line, filename: file.filename })
    }
  }
  return rows
}

function renderDiffLine(row, isSelected) {
  const gutterOld = row.oldLine != null ? String(row.oldLine).padStart(4) : '    '
  const gutterNew = row.newLine != null ? String(row.newLine).padStart(4) : '    '
  const gutter = `${gutterOld}${gutterNew} `

  if (row.type === 'file-header') {
    return chalk.hex(t.ui.selected).bold(`━━ ${row.filename}`) +
      chalk.hex(t.ci.pass)(` +${row.addCount}`) +
      chalk.hex(t.ci.fail)(` -${row.delCount}`)
  }
  if (row.type === 'hunk') {
    const line = chalk.bgHex(t.diff.hunkBg).hex(t.diff.hunkFg)(row.text.padEnd(80))
    return isSelected ? chalk.bgHex(t.diff.cursorBg)(line) : line
  }
  if (row.type === 'add') {
    const text = chalk.bgHex(t.diff.addBg).hex(t.diff.addFg)(gutter + row.text)
    return isSelected ? chalk.bgHex(t.diff.cursorBg)(text) : text
  }
  if (row.type === 'del') {
    const text = chalk.bgHex(t.diff.delBg).hex(t.diff.delFg)(gutter + row.text)
    return isSelected ? chalk.bgHex(t.diff.cursorBg)(text) : text
  }
  // ctx
  const text = chalk.hex(t.ui.dim)(gutter) + chalk.hex(t.diff.ctxFg)(row.text)
  return isSelected ? chalk.bgHex(t.diff.cursorBg)(text + ' ') : text
}

const FOOTER_KEYS = [
  { key: 'j/k', label: 'scroll' },
  { key: ']/[', label: 'file' },
  { key: 'c', label: 'comment' },
  { key: 'n/N', label: 'thread' },
  { key: 'v', label: 'comments' },
  { key: 'Esc', label: 'back' },
]

export function PRDiff({ prNumber, repo, onBack, onViewComments }) {
  const { stdout } = useStdout()
  const visibleHeight = Math.max(5, (stdout?.rows || 24) - 6)

  const { data: diffText, loading, error, refetch } = useGh(getPRDiff, [repo, prNumber])
  const { data: comments } = useGh(listPRComments, [repo, prNumber])
  const [cursor, setCursor] = useState(0)
  const [scrollOffset, setScrollOffset] = useState(0)
  const [dialog, setDialog] = useState(null)
  const [commentStatus, setCommentStatus] = useState(null)

  const files = useMemo(() => parseDiff(diffText || ''), [diffText])
  const rows = useMemo(() => flattenFiles(files), [files])

  const fileStartIndices = useMemo(() => {
    return rows.reduce((acc, row, i) => {
      if (row.type === 'file-header') acc.push(i)
      return acc
    }, [])
  }, [rows])

  const commentsByLine = useMemo(() => {
    const map = new Map()
    for (const c of (comments || [])) {
      const key = `${c.path}:${c.line}`
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(c)
    }
    return map
  }, [comments])

  const commentThreadIndices = useMemo(() => {
    return rows.reduce((acc, row, i) => {
      if (row.filename && row.newLine != null) {
        const key = `${row.filename}:${row.newLine}`
        if (commentsByLine.has(key)) acc.push(i)
      }
      return acc
    }, [])
  }, [rows, commentsByLine])

  const moveCursor = (delta) => {
    setCursor(prev => {
      const next = Math.max(0, Math.min(rows.length - 1, prev + delta))
      if (next < scrollOffset) setScrollOffset(next)
      if (next >= scrollOffset + visibleHeight) setScrollOffset(next - visibleHeight + 1)
      return next
    })
  }

  useInput((input, key) => {
    if (dialog) return
    if (input === 'r') { refetch(); return }
    if (key.escape || input === 'q') { onBack(); return }
    if (input === 'v') { onViewComments(); return }

    if (input === 'j' || key.downArrow) { moveCursor(1); return }
    if (input === 'k' || key.upArrow) { moveCursor(-1); return }

    if (input === ']') {
      // Next file
      const nextFile = fileStartIndices.find(i => i > cursor)
      if (nextFile != null) { setCursor(nextFile); setScrollOffset(Math.max(0, nextFile - 2)) }
      return
    }
    if (input === '[') {
      // Prev file
      const prevFile = [...fileStartIndices].reverse().find(i => i < cursor)
      if (prevFile != null) { setCursor(prevFile); setScrollOffset(Math.max(0, prevFile - 2)) }
      return
    }

    if (input === 'n') {
      const nextThread = commentThreadIndices.find(i => i > cursor)
      if (nextThread != null) { setCursor(nextThread); setScrollOffset(Math.max(0, nextThread - 2)) }
      return
    }
    if (input === 'N') {
      const prevThread = [...commentThreadIndices].reverse().find(i => i < cursor)
      if (prevThread != null) { setCursor(prevThread); setScrollOffset(Math.max(0, prevThread - 2)) }
      return
    }

    if (input === 'c') {
      const row = rows[cursor]
      if (row && row.type !== 'file-header') {
        setDialog('comment')
      }
      return
    }
  })

  if (dialog === 'comment') {
    const row = rows[cursor]
    const commentOptions = [
      { value: 'comment', label: 'Comment', description: 'Leave a regular comment' },
      { value: 'suggestion', label: 'Suggestion', description: 'Suggest a code change' },
      { value: 'request-changes', label: 'Request changes', description: 'Request changes to this PR' },
    ]
    return (
      <Box flexDirection="column" flexGrow={1}>
        <Box marginBottom={1} paddingX={1}>
          <Text color={t.ui.muted}>Commenting on: </Text>
          <Text color={t.diff.ctxFg} wrap="truncate">{row?.text}</Text>
        </Box>
        <OptionPicker
          title="Comment type"
          options={commentOptions}
          promptText="Comment body"
          onSubmit={async (val) => {
            const { value, text } = typeof val === 'object' ? val : { value: val, text: '' }
            if (!text) { setDialog(null); return }
            try {
              await addPRLineComment(repo, prNumber, {
                body: text,
                path: row.filename,
                line: row.newLine || row.oldLine,
                side: 'RIGHT',
              })
              setCommentStatus('Comment added')
              setTimeout(() => setCommentStatus(null), 3000)
            } catch (err) {
              setCommentStatus(`Failed: ${err.message}`)
              setTimeout(() => setCommentStatus(null), 3000)
            }
            setDialog(null)
          }}
          onCancel={() => setDialog(null)}
        />
      </Box>
    )
  }

  if (loading) {
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <Text color={t.ui.muted}>Loading diff...</Text>
      </Box>
    )
  }

  if (error) {
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <Text color={t.ci.fail}>⚠ Failed to load diff — r to retry</Text>
      </Box>
    )
  }

  const visibleRows = rows.slice(scrollOffset, scrollOffset + visibleHeight)

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box paddingX={1} justifyContent="space-between">
        <Text color={t.ui.selected} bold>PR #{prNumber} Diff</Text>
        {commentStatus && <Text color={t.ci.pass}>{commentStatus}</Text>}
        <Text color={t.ui.dim}>{cursor + 1}/{rows.length}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {visibleRows.map((row, i) => {
          const idx = scrollOffset + i
          const isSelected = idx === cursor
          const rendered = renderDiffLine(row, isSelected)
          // Check for inline comments
          const hasComment = row.filename && row.newLine != null &&
            commentsByLine.has(`${row.filename}:${row.newLine}`)
          return (
            <Box key={idx} flexDirection="column">
              <Text wrap="truncate">{rendered}</Text>
              {hasComment && (
                <Box
                  paddingX={2}
                  flexDirection="column"
                  borderStyle="single"
                  borderColor={t.diff.threadBorder}
                >
                  {commentsByLine.get(`${row.filename}:${row.newLine}`).map(c => (
                    <Box key={c.id} gap={1}>
                      <Text color={t.diff.threadBorder}>┃</Text>
                      <Text color={t.ui.selected} bold>{c.user?.login}</Text>
                      <Text color={t.ui.dim}>{c.body?.slice(0, 60)}</Text>
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          )
        })}
      </Box>
      <FooterKeys keys={FOOTER_KEYS} />
    </Box>
  )
}
