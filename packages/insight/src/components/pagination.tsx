import {FC} from 'react';
import styled from 'styled-components';

interface PaginationProps {
  currentPage: number;          // 1-indexed
  totalPages: number;           // pass 0 or 1 to render nothing
  onPageChange: (page: number) => void;
  /** How many pages to show on each side of `currentPage` before ellipsis. */
  windowSize?: number;
}

const Wrapper = styled.nav`
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin: 1rem 0;
  align-items: center;
  justify-content: center;
`;

const Button = styled.button<{$active?: boolean; $disabled?: boolean}>`
  min-width: 2.25rem;
  padding: 0.4rem 0.7rem;
  border: 1px solid ${({theme: {dark}}) => (dark ? '#444' : '#c0c4c8')};
  border-radius: 4px;
  cursor: ${({$disabled}) => ($disabled ? 'default' : 'pointer')};
  font-size: 0.95em;
  font-weight: ${({$active}) => ($active ? 600 : 400)};
  background: ${({$active, theme: {dark}}) =>
    $active ? (dark ? '#3a3a3a' : '#e2e8ef') : 'transparent'};
  color: ${({$disabled, theme: {dark}}) =>
    $disabled ? (dark ? '#555' : '#bbb') : dark ? '#fff' : '#222'};
  opacity: ${({$disabled}) => ($disabled ? 0.55 : 1)};
  &:hover {
    background: ${({$disabled, theme: {dark}}) =>
      $disabled ? 'transparent' : dark ? '#3a3a3a' : '#dfe6ed'};
  }
`;

const Ellipsis = styled.span`
  padding: 0.4rem 0.4rem;
  color: ${({theme: {dark}}) => (dark ? '#888' : '#888')};
`;

const Pagination: FC<PaginationProps> = ({
  currentPage,
  totalPages,
  onPageChange,
  windowSize = 2,
}) => {
  if (totalPages <= 1) return null;

  // Build the visible list: [1, …, current-window..current+window, …, last]
  // with ellipses where gaps exist. Always keep first + last so users have
  // an anchor.
  const pages: Array<number | 'ellipsis'> = [];
  const start = Math.max(2, currentPage - windowSize);
  const end = Math.min(totalPages - 1, currentPage + windowSize);
  pages.push(1);
  if (start > 2) pages.push('ellipsis');
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < totalPages - 1) pages.push('ellipsis');
  if (totalPages > 1) pages.push(totalPages);

  const atFirst = currentPage <= 1;
  const atLast = currentPage >= totalPages;

  return (
    <Wrapper aria-label='Pagination'>
      <Button $disabled={atFirst} onClick={() => !atFirst && onPageChange(1)} aria-label='First page'>
        «
      </Button>
      <Button
        $disabled={atFirst}
        onClick={() => !atFirst && onPageChange(currentPage - 1)}
        aria-label='Previous page'>
        ‹
      </Button>
      {pages.map((p, i) =>
        p === 'ellipsis' ? (
          <Ellipsis key={`e${i}`}>…</Ellipsis>
        ) : (
          <Button
            key={p}
            $active={p === currentPage}
            onClick={() => onPageChange(p)}
            aria-label={`Page ${p}`}
            aria-current={p === currentPage ? 'page' : undefined}>
            {p}
          </Button>
        ),
      )}
      <Button
        $disabled={atLast}
        onClick={() => !atLast && onPageChange(currentPage + 1)}
        aria-label='Next page'>
        ›
      </Button>
      <Button $disabled={atLast} onClick={() => !atLast && onPageChange(totalPages)} aria-label='Last page'>
        »
      </Button>
    </Wrapper>
  );
};

export default Pagination;
