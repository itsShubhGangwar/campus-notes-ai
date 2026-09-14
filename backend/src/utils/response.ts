import { Response } from 'express';

export interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
  error?: any;
}

export const sendSuccess = <T>(
  res: Response,
  data: T,
  message = 'Operation successful',
  statusCode = 200
) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
};

export const sendError = (
  res: Response,
  message = 'An error occurred',
  statusCode = 500,
  error: any = null
) => {
  return res.status(statusCode).json({
    success: false,
    message,
    ...(error ? { error } : {}),
  });
};
