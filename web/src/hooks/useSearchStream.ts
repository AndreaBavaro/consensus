import { useEffect, useRef, useState, useCallback } from 'react';
import { useSession } from '../context/SessionContext';
import { history } from '../services/history';
import { useNavigate } from 'react-router-dom';
import type { Insight, SourceStats } from '../types';



/**
 * Hook to handle streaming search results
 * @param {string} query - Search query
 * @param {Function} onSourcesUpdate - Callback for source updates
 * @param {Function} onConsensusData - Callback for consensus data
 * @param {Function} onThemeUpdate - Callback for theme updates
 * @param {Function} updateUltimateThemes - Callback for first batch data
 */
// Progress weights for each stage (based on actual event order)
const PROGRESS_STAGES = {
  STARTED: 5,
  SOURCES: 15,
  INSIGHTS_START: 25,
  INSIGHTS_MAX: 50,
  FIRST_BATCH: 60,
  COMMENTS: 70,
  FINAL_OPINIONS_START: 75,
  FINAL_OPINIONS_MAX: 95,
  COMPLETE: 100
};

const API_URL = import.meta.env.VITE_API_URL ?? '';
const MAX_X_SOURCES = 4;

const useSearchStream = (
  query,
  onSourcesUpdate,
  setUltimateThemes,
  fromDate,
  toDate,
  dateFilter,
  isHistorical = false,
  onInsightsUpdate: (insights: Insight[]) => void = () => {},
  onProgressUpdate: (progress: { percentage: number; stage: string }) => void = () => {},
  onSourceStats: (stats: SourceStats) => void = () => {}
) => {
  const { sessionId, setSessionId, updateMessagePart, refreshSessions } = useSession();
  const abortControllerRef = useRef(null);
  const allSourcesRef = useRef([]);
  const scoredCommentsRef = useRef([]);
  const navigate = useNavigate();
  const finalOpinionCameRef = useRef([]);
  const insightsRef = useRef([]); // Add ref for insights
  const [progress, setProgress] = useState({ percentage: 0, stage: 'idle' });
  const [error, setError] = useState<string | null>(null);
  let calculatedFromDate, calculatedToDate;

  // Progress update helper - ensures progress never goes backward
  const updateProgress = useCallback((percentage, stage) => {
    setProgress(prev => {
      // Only update if new percentage is higher (never go backward)
      if (percentage > prev.percentage) {
        const newProgress = { percentage, stage };
        onProgressUpdate(newProgress);
        return newProgress;
      }
      return prev;
    });
  }, [onProgressUpdate]);

  const formatDate = (date) => {
    return date.toISOString().split('T')[0];
  };

  const formatSearchQuery = (query, dateFilter, fromDate, toDate) => {
    let startDate, endDate;
    const today = new Date();

    if (dateFilter === 'custom' && fromDate !== 'none' && toDate !== 'none') {
      startDate = formatDate(new Date(fromDate));
      endDate = formatDate(new Date(toDate));
    } else if (dateFilter !== 'all') {
      endDate = formatDate(today);
      switch(dateFilter) {
        case '24h':
          startDate = formatDate(new Date(today.setDate(today.getDate() - 1)));
          break;
        case 'week':
          startDate = formatDate(new Date(today.setDate(today.getDate() - 7)));
          break;
        case 'month':
          startDate = formatDate(new Date(today.setMonth(today.getMonth() - 1)));
          break;
        case 'year':
          startDate = formatDate(new Date(today.setFullYear(today.getFullYear() - 1)));
          break;
      }
    }

    // Store the calculated dates for later use
    calculatedFromDate = startDate || fromDate;
    calculatedToDate = endDate || toDate || formatDate(new Date());

    if (dateFilter === 'all') {
      return query;
    }
    
    return `${query} after:${startDate} before:${endDate}`;
  };

  useEffect(() => {
    // Skip streaming for historical or empty queries
    if (isHistorical || !query?.trim()) {
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const processedLinks = new Set();
    allSourcesRef.current = [];  // Reset sources for new query
    const formattedQuery = formatSearchQuery(query, dateFilter, fromDate, toDate);
    let sources = [];
    let scoredComments = [];
    let sourceStats: SourceStats | null = null;

    // Start progress
    updateProgress(PROGRESS_STAGES.STARTED, 'connecting');

    const eventSource = new EventSource(
      `${API_URL}/api/search/streaming/v2?query=${encodeURIComponent(formattedQuery)}`
    );

    // Listen for specific event types that match backend
    eventSource.addEventListener('search_results', (event) => {
      try {
        const newSources = JSON.parse(event.data);
        if (newSources.length > 0) {
          sources = newSources;
          onSourcesUpdate(sources);
          updateMessagePart(query, 'sources', sources);
          updateProgress(PROGRESS_STAGES.SOURCES, 'sources');
        }
      } catch (error) {
        console.error('Error parsing search data:', error);
      }
    });

    eventSource.addEventListener('twitter_results', (event) => {
      try {
        const threads = (JSON.parse(event.data)?.threads || [])
          .filter((t) => t.link)
          .sort((a, b) => (b.likes || 0) - (a.likes || 0))
          .slice(0, MAX_X_SOURCES);
        if (threads.length > 0) {
          sources = [...sources, ...threads];
          onSourcesUpdate(sources);
          updateMessagePart(query, 'sources', sources);
        }
      } catch (error) {
        console.error('Error parsing twitter data:', error);
      }
    });

    eventSource.addEventListener('source_stats', (event) => {
      try {
        const stats = JSON.parse(event.data);
        sourceStats = stats;
        onSourceStats(stats);
        updateMessagePart(query, 'source_stats', stats);
      } catch (error) {
        console.error('Error parsing source stats:', error);
      }
    });

    eventSource.addEventListener('first_batch', (event) => {
      try {
        const data = JSON.parse(event.data);
        setUltimateThemes?.(data?.opinions);
        updateMessagePart(query, 'content', data?.opinions || []);
        updateProgress(PROGRESS_STAGES.FIRST_BATCH, 'analyzing');
      } catch (error) {
        console.error('Error parsing first batch data:', error);
      }
    });

    eventSource.addEventListener('scored_comments', (event) => {
      try {
        const commentData = JSON.parse(event.data);
        scoredComments = commentData;
        window.postMessage({ type: 'scored_comments', comments: commentData }, '*');
        updateMessagePart(query, 'scored_comments', commentData);
        updateProgress(PROGRESS_STAGES.COMMENTS, 'comments');
      } catch (error) {
        console.error('Error parsing scored comment data:', error);
      }
    });

    let insightBatchCount = 0;
    eventSource.addEventListener('insights_batch', (event) => {
      try {
        const insightData = JSON.parse(event.data);
        if (insightData.length > 0) {
          onInsightsUpdate(insightData);
          updateMessagePart(query, 'insights', insightData);
          insightsRef.current = [...insightsRef.current, ...insightData]; // Store insights in ref
          
          // Increment progress for each insight batch (between 25-50%)
          insightBatchCount++;
          const insightProgress = Math.min(
            PROGRESS_STAGES.INSIGHTS_START + (insightBatchCount * 6),
            PROGRESS_STAGES.INSIGHTS_MAX
          );
          updateProgress(insightProgress, 'insights');
        }
      } catch (error) {
        console.error('Error parsing insights data:', error);
      }
    });

    let finalOpinionCount = 0;
    eventSource.addEventListener('final_opinion', (event) => {
      try {
        const data = JSON.parse(event.data);
        finalOpinionCameRef.current.push(data);
        
        // Increment progress for each final opinion (between 75-95%)
        finalOpinionCount++;
        const finalProgress = Math.min(
          PROGRESS_STAGES.FINAL_OPINIONS_START + (finalOpinionCount * 3),
          PROGRESS_STAGES.FINAL_OPINIONS_MAX
        );
        updateProgress(finalProgress, 'finalizing');
      } catch (error) {
        console.error('Error parsing final opinion data:', error);
      }
    });

    eventSource.addEventListener('complete', async (event) => {
      // The server ends the stream right after this event; closing first keeps that from surfacing as an error.
      eventSource.close();
      updateProgress(PROGRESS_STAGES.COMPLETE, 'complete');
      const themes = finalOpinionCameRef?.current;
      setUltimateThemes?.(themes);
      updateMessagePart(query, 'content', themes);
      if (themes?.length > 0) {
        const id = history.save(sessionId, {
          query,
          timestamp: Date.now(),
          fromDate: calculatedFromDate ?? null,
          toDate: calculatedToDate ?? null,
          dateFilter,
          sources,
          content: themes,
          insights: insightsRef.current,
          source_stats: sourceStats,
        });
        if (id !== sessionId) {
          setSessionId(id);
          navigate(`/search?session=${id}`, { replace: true });
        }
        refreshSessions();
      }
    });

    eventSource.addEventListener('error', (event) => {
      const message = (event as MessageEvent).data
        ? JSON.parse((event as MessageEvent).data)?.message
        : 'Lost connection to the server. Please try again.';
      console.error('EventSource error:', message);
      setError(message);
      eventSource.close();
    });

    return () => {
      eventSource.close();
    };
  }, [query, onSourcesUpdate, setUltimateThemes, dateFilter, fromDate, toDate, isHistorical]);

  return { error, progress };
};

export default useSearchStream;
