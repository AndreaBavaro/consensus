import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronLeft, faLightbulb, faSpinner, faPlus, faClock } from '@fortawesome/free-solid-svg-icons';
import styles from './SearchResult.module.css';
import ConsensusCard from './ConsensusCard/ConsensusCard';
import Comments from './Comments/Comments';
import Sources from './Sources/Sources';
import useSearchStream from '../../../hooks/useSearchStream';
import { useSession } from '../../../context/SessionContext';
import MobileLogo from './MobileLogo/MobileLogo';
import HorizontalConsensusCard from './HorizontalConsensusCard/HorizontalConsensusCard';
import CommentsSidebar from './CommentsSidebar/CommentsSidebar';
import DateBadge from './DateBadge/DateBadge';
import InsightCard from './InsightCard/InsightCard';
import InsightLoader from './InsightLoader/InsightLoader';
import ProgressBar from './ProgressBar/ProgressBar';
import HorizontalConsensusLoader from './HorizontalConsensusLoader/HorizontalConsensusLoader';

import { useNavigate } from 'react-router-dom';
import { useSearchParams } from 'react-router-dom';
import type { ClassifiedComment, DateFilter, OpinionResult } from '../../../types';

interface SearchResultProps {
  query: string;
  liveQuery?: string | null;
  messageData?: any;
  isHistorical?: boolean;
  onThemeDataUpdate?: (themes: OpinionResult[]) => void;
  onCommentsUpdate?: (comments: ClassifiedComment[]) => void;
  dateFilter?: DateFilter;
  fromDate?: string | null;
  toDate?: string | null;
}

const SearchResult = React.memo(({ 
  liveQuery,
  query, 
  onCommentsUpdate, 
  dateFilter, 
  fromDate, 
  toDate,
  messageData = null,
  isHistorical = false
}: SearchResultProps) => {
  const [sources, setSources] = useState([]);
  const [scoredComments, setScoredComments] = useState([]);
  const [sourcesExpanded, setSourcesExpanded] = useState(true);
  const [selectedThemes, setSelectedThemes] = useState(new Set());
  const [expandedThemes, setExpandedThemes] = useState(new Set());
  const [sortBy, setSortBy] = useState(null);
  const [ultimateThemes, setUltimateThemes] = useState([]);
  const [localError, setLocalError] = useState(null);
  const [insights, setInsights] = useState([]);
  const [streamProgress, setStreamProgress] = useState({ percentage: 0, stage: 'idle' });
  const consensusCardRef = useRef(null);
  const leftSectionRef = useRef(null);
  const commentsRef = useRef(null);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { currentQuery } = useSession();

  // Extract SearchBar parameters
  const isHomePage = searchParams.get('source') === 'homepage';

  const handleSourcesUpdate = useCallback(newSources => {
    setSources(newSources);
  }, []);

  const handleExpandChange = useCallback((expanded) => {
    setSourcesExpanded(expanded);
    // Add a class to handle animation state
    const wrapper = document.querySelector(`.${styles.sourcesExpandedWrapper}`);
    if (wrapper) {
      wrapper.classList.toggle('expanded', expanded);
    }
  }, []);

  const handleThemeClick = useCallback((themeTitle) => {
    // Calculate both state updates together
    const wasSelected = selectedThemes.has(themeTitle);
    
    // Update selected themes
    const newSelectedThemes = new Set();
    if (!wasSelected) {
      newSelectedThemes.add(themeTitle);
    }
    
    // Update expanded themes
    const newExpandedThemes = new Set();
    if (!wasSelected) {
      newExpandedThemes.add(themeTitle);
    }

    // Batch state updates
    setSelectedThemes(newSelectedThemes);
    setExpandedThemes(newExpandedThemes);
    
    // Scroll after state updates
    requestAnimationFrame(() => {
      commentsRef.current?.scrollToTop();
    });
  }, [selectedThemes, commentsRef]);

  const handleThemeExpand = useCallback((themeTitle, isExpanding) => {
    setSelectedThemes(prev => {
      const newSet = new Set();
      if (isExpanding) {
        newSet.add(themeTitle);
      }
      return newSet;
    });
    setExpandedThemes(prev => {
      const newSet = new Set();
      if (isExpanding) {
        newSet.add(themeTitle);
      }
      return newSet;
    });
    commentsRef.current?.scrollToTop();
  }, []);

  const handleSortChange = useCallback((sort) => {
    setSortBy(sort);
    // Immediately scroll to top
    commentsRef.current?.scrollToTop();
  }, []);

  const [commentsSidebarState, setCommentsSidebarState] = useState({
    isOpen: false,
    activeTheme: null
  });

  const handleShowComments = useCallback((theme) => {
    setCommentsSidebarState(prev => {
      // If clicking the same theme that's already open, close the sidebar
      if (prev.isOpen && prev.activeTheme?.title === theme.title) {
        return {
          isOpen: false,
          activeTheme: null
        };
      }
      // Otherwise, open sidebar with the new theme
      return {
        isOpen: true,
        activeTheme: theme
      };
    });
  }, []);

  const handleCloseSidebar = useCallback(() => {
    setCommentsSidebarState({
      isOpen: false,
      activeTheme: null
    });
    setSortBy(null);
  }, []);

  useEffect(() => {
    if (commentsSidebarState.activeTheme && !expandedThemes.has(commentsSidebarState.activeTheme.title)) {
      handleCloseSidebar();
    }
  }, [expandedThemes, commentsSidebarState.activeTheme]);

  useEffect(() => {
    if (isHistorical) return; // Skip for historical results
    
    const handleMessage = (evt) => {
      if (evt.data && evt.data.type === 'scored_comments') {
        setScoredComments(evt.data.comments);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [isHistorical, onCommentsUpdate]);

  useEffect(() => {
    if (isHistorical && messageData) {
      setUltimateThemes(messageData.content);
      setSources(messageData.sources || []);
      setScoredComments(messageData.scored_comments || []);
      setInsights(messageData.insights || []); 
    } else if (!isHistorical) {
      // Reset insights when starting a new search
      setInsights([]);
    }
  }, [isHistorical, messageData]);

  const handleInsightsUpdate = (newInsights) => {
    setInsights(currentInsights => [...currentInsights, ...newInsights]);
  };

  const handleProgressUpdate = (progress) => {
    setStreamProgress(progress);
  };

  // Always call useSearchStream, but pass isHistorical flag
  const { error: searchError, progress } = useSearchStream(
    isHistorical ? null : liveQuery,
    handleSourcesUpdate,
    setUltimateThemes,
    fromDate,
    toDate,
    dateFilter,
    isHistorical,
    handleInsightsUpdate,
    handleProgressUpdate
  );

  // Determine if the stream is complete
  const isStreamComplete = isHistorical || streamProgress.stage === 'complete';

  const displayError = localError || searchError;

  return (
    <div className={styles.pageContainer}>
      <div className={`${styles.mainContent} ${commentsSidebarState.isOpen ? styles.sidebarOpen : ''}`}>
        {displayError && (
          <div className={styles.error}>
            {displayError}
          </div>
        )}

        {/* Progress Bar - only show for live queries */}
        {!isHistorical && liveQuery && (
          <ProgressBar 
            progress={streamProgress} 
            isComplete={isStreamComplete}
          />
        )}

        <div className={styles.titleWrapper}>
          <h1 className={styles.title}>{query}</h1>
          <div className={styles.titleActions}>
          </div>
          <div className={styles.leftSection} ref={leftSectionRef}>
            <div className={styles.searchInfo}>
            </div>
          </div>
        </div>
        <div className={styles.topBar}>
          <div className={styles.sourcesSection}>
            <div className={styles.sourceHeader}>
              {sources && sources.length > 0 && (
                <div 
                  className={styles.showMoreButton}
                  onClick={() => handleExpandChange(!sourcesExpanded)}
                >
                  <FontAwesomeIcon 
                    icon={faPlus} 
                    className={styles.plusIcon}
                    style={{ transform: sourcesExpanded ? 'rotate(45deg)' : 'none' }}
                  />
                  <span>
                    {sourcesExpanded ? 'Show Less' : `Show ${sources.length} More Sources`}
                  </span>
                </div>
              )}
              <DateBadge 
                dateFilter={dateFilter}
                fromDate={fromDate}
                toDate={toDate}
              />
            </div>
            <div 
              className={`${styles.sourcesExpandedWrapper} ${!sourcesExpanded ? styles.sourcesCollapsed : ''}`}
            >
              <Sources 
                sources={sources} 
                comments={scoredComments} 
                onExpandChange={handleExpandChange}
              />
            </div>
          </div>
        </div>

        <div className={styles.horizontalConsensusWrapper}>
          {ultimateThemes && ultimateThemes.length > 0 ? (
            <HorizontalConsensusCard 
              opinions={ultimateThemes}
              dateFilter={dateFilter}
              fromDate={fromDate}
              toDate={toDate}
              onThemeClick={handleThemeClick}
              onThemeExpand={handleThemeExpand}
              onShowComments={handleShowComments}
              expandedThemes={expandedThemes}
              activeCommentTheme={commentsSidebarState?.activeTheme}
            />
          ) : (
            <HorizontalConsensusLoader />
          )}
        </div>

        <div className={styles.insightsGrid}>
          {insights && insights.length > 0 ? (
            <div className={styles.insightsWrapper}>
              {insights.map((insight, index) => (
                <InsightCard key={index} data={insight} />
              ))}
            </div>
          ) : (
            <InsightLoader />
          )}
        </div>

            

          </div>

      <CommentsSidebar
        isOpen={commentsSidebarState.isOpen}
        onClose={handleCloseSidebar}
        theme={commentsSidebarState.activeTheme}
        sortBy={sortBy}
        onSortChange={handleSortChange}
      >
        <Comments 
          ref={commentsRef}
          consensusLoaded={true}
          ultimateThemesData={commentsSidebarState.activeTheme ? [commentsSidebarState.activeTheme] : []}
          selectedThemes={new Set([commentsSidebarState.activeTheme?.title].filter(Boolean))}
          sortBy={sortBy}
        />
      </CommentsSidebar>
    </div>
  );
}, (prevProps, nextProps) => {
  // Only re-render if the query changes
  return prevProps.query === nextProps.query;
});

SearchResult.displayName = 'SearchResult';

export default SearchResult;
