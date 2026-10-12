import React, { createContext, useState, useContext } from 'react';
import { history } from '../services/history';

const SessionContext = createContext<any>(null);

export const SessionProvider = ({ children }) => {
  const [sessionId, setSessionId] = useState(null);
  
  // Add console log wrapper for setSessionId
  const wrappedSetSessionId = (newSessionId) => {
    setSessionId(newSessionId);
  };

  const [currentQuery, setCurrentQuery] = useState(null);
  const [messages, setMessages] = useState([]);
  const [sessionList, setSessions] = useState(() => history.list());
  const [fromDate, setFromDate] = useState(null);
  const [toDate, setToDate] = useState(null);
  const [dateFilter, setDateFilter] = useState('all');

  const addMessage = (query, from, to, filter) => {
    // Check if query already exists in messages
    if (messages.some(msg => msg.query === query)) return;
    
    const newMessage = {
      query,
      fromDate: from,
      toDate: to,
      dateFilter: filter,
      timestamp: new Date(),
      messageData: null,
      sources: [],
      scored_comments: [],
      content: [],
      insights: [],
      isComplete: false
    };
    setMessages(prev => [newMessage, ...prev]);
  };

  const updateMessageData = (query, data) => {
    setMessages(prev => 
      prev.map(msg => 
        msg.query === query 
          ? { 
              ...msg, 
              messageData: data,
              sources: data.sources || msg.sources,
              scored_comments: data.scored_comments || msg.scored_comments,
              content: data.content || msg.content,
              insights: data.insights || msg.insights,
              isComplete: true,
              // Preserve date information
              fromDate: msg.fromDate,
              toDate: msg.toDate,
              dateFilter: msg.dateFilter
            } 
          : msg
      )
    );
  };

  // New function to update individual parts of a message
  const updateMessagePart = (query, part, data) => {
    setMessages(prev =>
      prev.map(msg =>
        msg.query === query
          ? {
              ...msg,
              [part]: part === 'insights' ? [...(msg.insights || []), ...data] : data,
              messageData: {
                ...msg.messageData,
                [part]: part === 'insights' ? [...(msg.messageData?.insights || []), ...data] : data,
                // Preserve date information in messageData
                fromDate: msg.fromDate,
                toDate: msg.toDate,
                dateFilter: msg.dateFilter
              }
            }
          : msg
      )
    );
  };

  const setMessagesArray = (newMessages) => {
    if (!newMessages) {
      setMessages([]);
      return;
    }
    
    const formattedMessages = newMessages.map(msg => {      
      return {
        query: msg.query,
        timestamp: msg.timestamp,
        fromDate: msg.fromDate || null,
        toDate: msg.toDate || null,
        dateFilter: msg.dateFilter || 'all',
        messageData: {
          sources: msg.sources || [],
          scored_comments: msg.scored_comments || [],
          content: msg.content || [],
          insights: msg.insights || [],
          source_stats: msg.source_stats || null,
          fromDate: msg.fromDate || null,
          toDate: msg.toDate || null,
          dateFilter: msg.dateFilter || 'all'
        },
      };
    });
    
    setMessages(formattedMessages);
  };

  const refreshSessions = () => setSessions(history.list());

  const deleteSession = (sessionId) => {
    history.remove(sessionId);
    refreshSessions();
  };

  const setCurrentQueryWithDates = (query, from, to, filter) => {
    setCurrentQuery(query);
    setFromDate(from);
    setToDate(to);
    setDateFilter(filter);
  };

  const value = {
    sessionId,
    setSessionId: wrappedSetSessionId,
    currentQuery,
    setCurrentQuery,
    setCurrentQueryWithDates,
    messages,
    addMessage,
    updateMessageData,
    updateMessagePart,
    setMessagesArray,
    sessionList,
    refreshSessions,
    deleteSession,
    fromDate,
    setFromDate,
    toDate,
    setToDate,
    dateFilter,
    setDateFilter
  };

  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  );
};

// Custom hook to use session context
export const useSession = () => {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return context;
};
