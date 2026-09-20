export type Role = 'USER' | 'ADMIN';

export interface College {
  id: string;
  name: string;
  code?: string | null;
  city?: string | null;
  state?: string | null;
  _count?: {
    branches: number;
  };
}

export interface Branch {
  id: string;
  name: string;
  code: string;
  collegeId: string;
}

export interface Subject {
  id: string;
  name: string;
  code: string;
  semester: number;
  branchId: string;
  description?: string | null;
}

export interface Tag {
  id: string;
  name: string;
  slug: string;
}

export interface NoteTag {
  noteId: string;
  tagId: string;
  tag: Tag;
}

export interface NoteChunk {
  id: string;
  chunkIndex: number;
  pageNumber?: number | null;
  content: string;
  tokenCount?: number | null;
  createdAt: string;
}

export interface Note {
  id: string;
  title: string;
  description?: string | null;
  uploaderId: string;
  uploader: {
    id: string;
    name: string;
    email: string;
    avatarUrl?: string | null;
    role?: Role;
  };
  collegeId: string;
  college: {
    id: string;
    name: string;
    code?: string | null;
    city?: string | null;
  };
  branchId: string;
  branch: {
    id: string;
    name: string;
    code: string;
  };
  semester: number;
  subjectId: string;
  subject: {
    id: string;
    name: string;
    code: string;
    semester: number;
    description?: string | null;
  };
  fileUrl: string;
  fileKey: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  pageCount: number;
  isPublished: boolean;
  processingStatus: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  processingError?: string | null;
  viewsCount: number;
  downloadsCount: number;
  likesCount: number;
  bookmarksCount: number;
  averageRating: number;
  ratingsCount: number;
  createdAt: string;
  updatedAt: string;
  tags?: NoteTag[];
  isLiked?: boolean;
  isBookmarked?: boolean;
  _count?: {
    downloads: number;
    likes: number;
    bookmarks: number;
    chunks?: number;
  };
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  avatarUrl?: string | null;
  bio?: string | null;
  collegeId?: string | null;
  branchId?: string | null;
  semester?: number | null;
  college?: {
    id: string;
    name: string;
    code?: string | null;
  } | null;
  branch?: {
    id: string;
    name: string;
    code: string;
  } | null;
  createdAt: string;
}

export interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasMore: boolean;
}

export interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  data: T;
  error?: any;
}

export interface NoteChunk {
  id: string;
  chunkIndex: number;
  pageNumber?: number | null;
  content: string;
  tokenCount?: number | null;
  hasEmbedding?: boolean;
  embeddingDims?: number | null;
  createdAt: string;
}

export interface RecommendationItem {
  rank: number;
  note_id: string;
  title: string;
  subject_id: string;
  semester: number | null;
  branch_id: string | null;
  engagement_score: number;
}

export interface RecommendationResponse {
  user_id: string;
  model_version: string;
  inference_timestamp: string;
  candidate_count: number;
  recommendation_count: number;
  recommendations: RecommendationItem[];
}

