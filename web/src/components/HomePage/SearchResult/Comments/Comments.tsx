import React, { useMemo, useRef, useImperativeHandle, forwardRef } from 'react';
import Comment from '../Comment/Comment';
import CommentsLoader from '../Comment/CommentsLoader';
import styles from './Comments.module.css';
import { getThemeColor } from '../../../../utils/themeColors';
import type { ClassifiedComment, OpinionResult, SortBy } from '../../../../types';

interface CommentsProps {
  consensusLoaded: boolean;
  ultimateThemesData?: OpinionResult[];
  scoredComments?: ClassifiedComment[];
  selectedThemes: Set<string>;
  sortBy: SortBy;
}

export interface CommentsHandle {
  scrollToTop: () => void;
}

const Comments = forwardRef<CommentsHandle, CommentsProps>(({ 
  consensusLoaded, 
  ultimateThemesData, 
  scoredComments = [], 
  selectedThemes, 
  sortBy 
}, ref) => {
  const commentsContainerRef = useRef(null);

  useImperativeHandle(ref, () => ({
    scrollToTop: () => {
      if (commentsContainerRef.current) {
        commentsContainerRef.current.scrollTo({
          top: 0,
          behavior: 'smooth'
        });
      }
    }
  }));

  // Theme color mapping based on opinion titles
  const themeColorMap = useMemo(() => {
    const map = new Map();
    ultimateThemesData?.forEach(({ title }) => {
      map.set(title, getThemeColor(title));
    });
    return map;
  }, [ultimateThemesData]);

  // Process comments based on whether we have ultimate themes or scored comments
  const processedComments = useMemo(() => {
    // If themes are selected and we have ultimate themes data, show those
    if (selectedThemes.size > 0 && ultimateThemesData?.length) {
      // Get comments only from selected opinions
      return ultimateThemesData
        .filter(opinion => selectedThemes.has(opinion.title))
        .flatMap(opinion => 
          opinion.comments_support.map(comment => ({
            ...comment,
            upvotes: comment.score,
            themeColor: themeColorMap.get(opinion.title)
          }))
        );
    }

    // If no themes are selected, show scored comments (if any)
    if (scoredComments?.length > 0) {
      return scoredComments.map(comment => ({
        ...comment,
        upvotes: comment.score,
        themeColor: getThemeColor('default')
      }));
    }

    // If no scored comments, show all ultimate themes comments
    if (ultimateThemesData?.length) {
      return ultimateThemesData.flatMap(opinion => 
        opinion.comments_support.map(comment => ({
          ...comment,
          upvotes: comment.score,
          themeColor: themeColorMap.get(opinion.title)
        }))
      );
    }

    return [];
  }, [ultimateThemesData, selectedThemes, themeColorMap, scoredComments]);

  // Sort comments only if sort option is selected, otherwise keep original order
  const sortedComments = useMemo(() => {
    if (!processedComments.length) return processedComments;
    
    return processedComments.slice().sort((a, b) => {
      if (sortBy === 'relevance') {
        return b.ai_score - a.ai_score;
      }
      if (sortBy === 'date') {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
      return b.score - a.score;
    });
  }, [processedComments, sortBy]);

  return (
    <div className={styles.container}>
      <div className={styles.commentsContainer} ref={commentsContainerRef}>
        {processedComments.length > 0 ? (
          sortedComments.map((comment, index) => (
            <Comment key={`${comment.comment_url}-${index}`} {...comment} index={index} />
          ))
        ) : (
          <CommentsLoader consensusLoaded={consensusLoaded} />
        )}
      </div>
    </div>
  );
});

export default Comments;
