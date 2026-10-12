import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { ThumbsUp, ThumbsDown, MessageCircle, ChevronUp } from 'lucide-react';
import styles from './InsightCard.module.css';
import Comment from '../Comment/Comment';
import type { CSSVars } from '../../../../types';

const ACCENT_COLORS = [
  '#3B82F6', // blue
  '#EAB308', // yellow
  '#A855F7', // purple
  '#EF4444', // red
  '#22C55E', // green
  '#14B8A6', // teal
  '#EC4899'  // pink
];

const InsightCard = ({ data }) => {
  const [showComments, setShowComments] = useState(false);
  
  const accentColor = React.useMemo(() => {
    const randomIndex = Math.floor(Math.random() * ACCENT_COLORS.length);
    return ACCENT_COLORS[randomIndex];
  }, []);

  const getSentimentIcon = () => {
    const iconProps = {
      className: styles.sentimentIcon,
      size: 20
    };

    switch (data.sentiment) {
      case 'positive':
        return <ThumbsUp {...iconProps} color="#22C55E" />;
      case 'negative':
        return <ThumbsDown {...iconProps} color="#EF4444" />;
      default:
        return <ThumbsUp {...iconProps} color="#EAB308" />;
    }
  };

  return (
    <div 
      className={styles.container}
      style={{ '--accent-color': accentColor } as CSSVars}
    >
      <div className={styles.contentRow}>
        <svg 
          className={styles.quoteIcon}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151C21.838 6.008 19.703 8.031 19.703 11h3.291v10h-8.977zm-14 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151C7.855 6.008 5.721 8.031 5.721 11h3.291v10H.017z" />
        </svg>
        <div className={styles.markdownWrapper}>
          <ReactMarkdown>{data.insight_phrase}</ReactMarkdown>
        </div>
      </div>
      
      <div className={styles.footer}>
        <div className={styles.metaInfo}>
          <button 
            className={`${styles.commentToggle} ${showComments ? styles.active : ''}`}
            onClick={() => setShowComments(!showComments)}
          >
            <MessageCircle size={14} />
            <span>Comments</span>
          </button>
          <div className={styles.statsGroup}>
            <span className={styles.timestamp}>{data.temporal_context}</span>
            <div className={styles.dot}></div>
            <div className={styles.upvoteIndicator}>
              <ChevronUp size={14} strokeWidth={2.5} />
              <span>{data.upvotes} upvotes</span>
            </div>
          </div>
        </div>
        {getSentimentIcon()}
      </div>

      {showComments && (
        <div className={styles.commentsContainer}>
          {data.supporting_comments.map((comment, index) => (
            <Comment 
              key={comment.index || index}
              {...comment}
              themeColor="neutral"
              index={index}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default InsightCard;
