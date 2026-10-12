import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowUp, faLink } from '@fortawesome/free-solid-svg-icons';
import styles from './Comment.module.css';
import ReactMarkdown from 'react-markdown';
import SourceIcon from '../../../common/SourceIcon';
import type { ClassifiedComment, CSSVars } from '../../../../types';
import { getRelativeTime, getFormattedDate } from '../../../../utils/dateUtils';

type CommentProps = Partial<ClassifiedComment> & {
  index: number;
  themeColor?: string;
};

const Comment = ({ upvotes, likes, source, post_title, comment_url, post_url, content, index, author, themeColor, created_at }: CommentProps) => {
  // Extract subreddit name from post_url with fallback
  const subredditName = post_url?.match(/\/r\/([^/]+)/)?.[1] || 'reddit';
  const fromX = source === 'twitter';

  const handlePostClick = (e) => {
    e.stopPropagation();
    if (post_url) {
      window.open(post_url, '_blank');
    }
  };

  const handleSubredditClick = (e) => {
    e.stopPropagation();
    window.open(fromX ? post_url : `https://reddit.com/r/${subredditName}`, '_blank');
  };

  // Custom components for ReactMarkdown
  const components = {
    a: ({ node, ...props }) => (
      <a 
        {...props} 
        className={styles.contentLink}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => {
          e.stopPropagation();
          window.open(props.href, '_blank');
        }}
      />
    )
  };

  return (
    <div className={`${styles.container} ${themeColor ? styles[themeColor] : ''}`} style={{ '--index': index } as CSSVars}>
      <div className={styles.header}>
        <SourceIcon source={source} className={styles.redditIcon} />
        <span className={styles.subreddit} onClick={handleSubredditClick}>{fromX ? (author ? `@${author}` : 'X') : `r/${subredditName}`}</span>
        <span className={styles.dot}>•</span>
        <span className={styles.postTitle} onClick={handlePostClick}>{post_title}</span>
      
      </div>
      
      <div className={styles.content}>
        <ReactMarkdown components={components}>{content}</ReactMarkdown>
      </div>
      
      <div className={styles.footer}>
        <FontAwesomeIcon icon={faArrowUp} className={styles.upArrow} />
        <span className={styles.upvotes}>{fromX ? `${likes ?? upvotes} likes` : `${upvotes} upvotes`}</span>
        <span className={styles.dot}>•</span>
        <span className={styles.date} title={getFormattedDate(created_at)}>
          {getRelativeTime(created_at)}
        </span>
        <span className={styles.dot}>•</span>
        <FontAwesomeIcon 
          icon={faLink} 
          className={styles.linkIcon} 
          onClick={(e) => {
            e.stopPropagation();
            window.open(comment_url, '_blank');
          }}
        />
      </div>
    </div>
  );
};

export default Comment;
