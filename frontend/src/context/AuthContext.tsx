import React, { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../services/api';
import { User, ApiResponse } from '../types';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (payload: any) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(() => {
    const savedUser = localStorage.getItem('user');
    return savedUser ? JSON.parse(savedUser) : null;
  });
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'));
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const refreshUser = async () => {
    try {
      const storedToken = localStorage.getItem('token');
      if (!storedToken) {
        setUser(null);
        setIsLoading(false);
        return;
      }

      const res = await api.get<ApiResponse<User>>('/auth/me');
      if (res.data.success && res.data.data) {
        setUser(res.data.data);
        localStorage.setItem('user', JSON.stringify(res.data.data));
      }
    } catch {
      // Token is expired or invalid
      setUser(null);
      setToken(null);
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshUser();
  }, []);

  const login = async (email: string, password: string) => {
    const res = await api.post<ApiResponse<{ user: User; token: string }>>('/auth/login', {
      email,
      password,
    });

    if (res.data.success && res.data.data) {
      const { user: loggedInUser, token: receivedToken } = res.data.data;
      setUser(loggedInUser);
      setToken(receivedToken);
      localStorage.setItem('user', JSON.stringify(loggedInUser));
      localStorage.setItem('token', receivedToken);
    }
  };

  const register = async (payload: any) => {
    const res = await api.post<ApiResponse<{ user: User; token: string }>>('/auth/register', payload);

    if (res.data.success && res.data.data) {
      const { user: registeredUser, token: receivedToken } = res.data.data;
      setUser(registeredUser);
      setToken(receivedToken);
      localStorage.setItem('user', JSON.stringify(registeredUser));
      localStorage.setItem('token', receivedToken);
    }
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch (e) {
      console.warn('Backend logout call failed or network error:', e);
    } finally {
      setUser(null);
      setToken(null);
      localStorage.removeItem('user');
      localStorage.removeItem('token');
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        login,
        register,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
