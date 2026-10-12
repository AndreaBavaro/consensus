import { memo, useState } from 'react';
import { ArrowBigUp, ArrowRight, ArrowUpRight, Check, Copy, Heart, MessageCircle, MessageSquare, Repeat2 } from 'lucide-react';
import type { AuthorProfile, Community, Intent, Post } from './api';
import { compact, INTENT_META, timeAgo } from './format';
import { RedditMark, XMark } from './icons';
import { cleanPostText } from './postText';

export function useCopy(): [string | null, (key: string, text: string) => void] {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (key: string, text: string) => {
    void navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1400);
  };
  return [copied, copy];
}

function Img({ src, className, fallback, bg }: { src: string | null | undefined; className: string; fallback: React.ReactNode; bg?: string | null }) {
  const [bad, setBad] = useState(false);
  const style = bg ? { background: bg } : undefined;
  if (!src || bad)
    return (
      <span className={`${className} fallback`} style={style}>
        {fallback}
      </span>
    );
  return <img className={className} src={src} alt="" decoding="async" referrerPolicy="no-referrer" onError={() => setBad(true)} style={style} />;
}

function Letter({ name, color }: { name: string; color?: string | null }) {
  const ch = name.replace(/^(r\/|u\/|@)/, '').trim()[0]?.toUpperCase() ?? '?';
  return (
    <span className="letter" style={{ color: color ? '#fff' : undefined }}>
      {ch}
    </span>
  );
}

/** Reddit rows show the community icon (Reddit has no useful profile photos); X rows show the author photo. */
export function PostIcon({ post, community }: { post: Post; community?: Community }) {
  if (post.source === 'reddit') {
    // Many community icons are transparent PNGs; the community color keeps them visible on any theme.
    const color = community?.color ?? null;
    const fb = post.community ? <Letter name={post.community} color={color ?? '#FF4500'} /> : <RedditMark size={34} />;
    return <Img src={community?.icon} className="post-icon ring" bg={color ?? (post.community ? '#FF4500' : null)} fallback={fb} />;
  }
  return <Img src={post.author.avatar} className="post-icon" fallback={<Letter name={post.author.name || post.author.handle} />} />;
}

export function IntentPill({ intent }: { intent: Intent | null }) {
  if (!intent) return null;
  const m = INTENT_META[intent];
  return (
    <span className={`intent intent-${intent}`} style={{ ['--c' as string]: m.color }}>
      {m.label}
    </span>
  );
}

function Byline({ post }: { post: Post }) {
  const age = timeAgo(post.created_at);
  if (post.source === 'reddit')
    return (
      <div className="byline">
        <strong className="by-main">{post.community ?? 'Reddit'}</strong>
        <span className="by-sub by-handle">u/{post.author.handle}</span>
        {age && <span className="by-sub by-age">{age}</span>}
      </div>
    );
  return (
    <div className="byline">
      <strong className="by-main">{post.author.name || `@${post.author.handle}`}</strong>
      {post.author.name && <span className="by-sub by-handle">@{post.author.handle}</span>}
      {post.author.followers ? <span className="by-sub by-followers">{compact(post.author.followers)} followers</span> : null}
      {age && <span className="by-sub by-age">{age}</span>}
    </div>
  );
}

export function Engagement({ post }: { post: Post }) {
  if (post.source === 'reddit')
    return (
      <div className="engage">
        <span data-tip="Upvotes">
          <ArrowBigUp size={16} /> {compact(post.score)}
        </span>
        <span data-tip="Replies">
          <MessageSquare size={14} /> {compact(post.replies ?? 0)}
        </span>
      </div>
    );
  return (
    <div className="engage">
      <span data-tip="Likes">
        <Heart size={14} /> {compact(post.score)}
      </span>
      <span data-tip="Replies">
        <MessageCircle size={14} /> {compact(post.replies ?? 0)}
      </span>
      <span data-tip="Reposts">
        <Repeat2 size={15} /> {compact(post.reposts ?? 0)}
      </span>
    </div>
  );
}

function cleanText(post: Post) {
  // Thread openers arrive as "title\nbody"; show the title once, in bold.
  if (post.kind === 'opener' && post.thread_title && post.text.startsWith(post.thread_title)) {
    return { title: cleanPostText(post.thread_title), body: cleanPostText(post.text.slice(post.thread_title.length)) };
  }
  return { title: null, body: cleanPostText(post.text) };
}

export const PostRow = memo(function PostRow({
  post,
  community,
  lead,
  copied,
  onCopy,
  tag,
}: {
  post: Post;
  community?: Community;
  lead?: boolean;
  copied?: boolean;
  onCopy?: (p: Post) => void;
  /** The answer this post counts toward, shown in the All opinions view. */
  tag?: { title: string; color: string };
}) {
  const [open, setOpen] = useState(false);
  const { title, body } = cleanText(post);
  const flat = body.replace(/\s+/g, ' ');
  const long = (title?.length ?? 0) + flat.length > 260;
  return (
    <article className="post">
      <PostIcon post={post} community={community} />
      <div className="post-main">
        <div className="post-top">
          <Byline post={post} />
          <a className="post-src" href={post.url} target="_blank" rel="noreferrer" data-tip={post.source === 'reddit' ? 'Open on Reddit' : 'Open on X'} aria-label="Open original">
            {post.source === 'reddit' ? <RedditMark size={16} /> : <XMark size={13} />}
            <ArrowUpRight size={15} className="post-ext" />
          </a>
        </div>
        <div className={`post-text ${open ? 'open' : ''}`}>
          {title && <strong className="post-title">{title} </strong>}
          {open ? body : flat}
        </div>
        {long && (
          <button className="link-btn more" onClick={() => setOpen((o) => !o)}>
            {open ? 'Show less' : 'Show more'}
          </button>
        )}
        <div className="post-foot">
          <Engagement post={post} />
          <div className="post-tags">
            {tag && (
              <span className="opt-tag" style={{ ['--c' as string]: tag.color }} title={tag.title}>
                <i />
                <span>{tag.title}</span>
              </span>
            )}
            <IntentPill intent={post.intent} />
            {lead && (
              <>
                <a className="btn tiny ghost" href={post.url} target="_blank" rel="noreferrer">
                  Open <ArrowUpRight size={13} />
                </a>
                <button className="icon-btn small" onClick={() => onCopy?.(post)} aria-label="Copy link" data-tip={copied ? 'Copied' : 'Copy link'}>
                  {copied ? <Check size={15} /> : <Copy size={14} />}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </article>
  );
});

/** Desktop leads: one dense, scannable table row per lead. */
export function LeadsTable({
  posts,
  communities,
  authors,
  copied,
  onCopy,
}: {
  posts: Post[];
  communities: Record<string, Community>;
  authors: Record<string, AuthorProfile>;
  copied: string | null;
  onCopy: (p: Post) => void;
}) {
  return (
    <div className="leads-table" role="table">
      <div className="lt-row lt-head" role="row">
        <span>Source</span>
        <span>Author</span>
        <span>Quote</span>
        <span>Intent</span>
        <span>Engagement</span>
        <span>Age</span>
        <span />
      </div>
      {posts.map((p) => {
        const karma = p.source === 'reddit' ? authors[p.author.handle]?.karma : null;
        return (
          <div className="lt-row" role="row" key={p.id}>
            <span className="lt-src">
              <PostIcon post={p} community={p.community ? communities[p.community] : undefined} />
            </span>
            <span className="lt-author">
              <a href={p.author.profile_url ?? p.url} target="_blank" rel="noreferrer">
                <strong>{p.source === 'reddit' ? p.community : p.author.name || `@${p.author.handle}`}</strong>
              </a>
              <span>
                {p.source === 'reddit' ? `u/${p.author.handle}` : `@${p.author.handle}`}
                {p.source === 'x' && p.author.followers ? ` · ${compact(p.author.followers)}` : ''}
                {karma ? ` · ${compact(karma)} karma` : ''}
              </span>
            </span>
            <span className="lt-quote" title={cleanPostText(p.text)}>
              {cleanPostText(p.text)}
            </span>
            <span>
              <IntentPill intent={p.intent} />
            </span>
            <span className="lt-engage">
              <Engagement post={p} />
            </span>
            <span className="lt-age">{timeAgo(p.created_at).replace(' ago', '')}</span>
            <span className="lt-actions">
              <button className="icon-btn small" onClick={() => onCopy(p)} aria-label="Copy link" data-tip={copied === p.id ? 'Copied' : 'Copy link'}>
                {copied === p.id ? <Check size={15} /> : <Copy size={14} />}
              </button>
              <a className="icon-btn small" href={p.url} target="_blank" rel="noreferrer" aria-label="Open" data-tip="Open">
                <ArrowRight size={16} />
              </a>
            </span>
          </div>
        );
      })}
    </div>
  );
}
