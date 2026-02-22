// The URL of the Gryt Authentication Server used by the client.
// ⚠️ IMPORTANT: Changing this value is strongly discouraged and may cause the client to lose the ability to connect to any servers.
// Gryt Authentication Server is CLOSED-SOURCE and acts as a trusted middleware for verifying user identities across all servers.
// This centralized authentication ensures a seamless user experience by eliminating the need to create separate accounts for each server.
// Without Gryt Authentication, user verification is impossible, forcing each server to manage its own authentication—
// a scenario that compromises user convenience and security by requiring you to share credentials with multiple server hosts.
const grytAuthHost = "https://auth.gryt.chat" as const;

import axios, { AxiosInstance, AxiosResponse } from "axios";

import { LoginData, RegisterData } from "@/common";

interface RefreshData {
  refreshToken: string;
}

interface JoinTokenResponse {
  joinToken: string;
  userId: string;
  nickname: string;
}

export class AuthApi {
  private axiosInstance: AxiosInstance;
  private baseURL: string;

  constructor() {
    this.baseURL = grytAuthHost;
    this.axiosInstance = axios.create({
      baseURL: this.baseURL,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  public async register(data: RegisterData): Promise<AxiosResponse<unknown>> {
    const response = await this.axiosInstance.post("/auth/register", data);
    return response;
  }

  public async login(data: LoginData): Promise<AxiosResponse<unknown>> {
    const response = await this.axiosInstance.post("/auth/login", data);
    return response;
  }

  public async refresh(data: RefreshData): Promise<AxiosResponse<unknown>> {
    const response = await this.axiosInstance.post("/refresh", data);
    return response;
  }

  public async getJoinToken(token: string): Promise<AxiosResponse<JoinTokenResponse>> {
    const response = await this.axiosInstance.post("/api/joinToken", { token });
    return response;
  }
}
