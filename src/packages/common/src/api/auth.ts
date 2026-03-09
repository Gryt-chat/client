import axios, { AxiosInstance, AxiosResponse } from "axios";

import { getGrytConfig } from "../../../../config";
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
    this.baseURL = getGrytConfig().GRYT_AUTH_API;
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
