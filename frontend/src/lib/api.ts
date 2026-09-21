import axios from "axios"
import { clearToken, getToken } from "./auth"

export const api = axios.create({
    baseURL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000",
    headers: { "Content-Type": "application/json" }
})

// Request Interceptors: runs before EVERY request.
//  It reads the token and if present , adds the Auth header

api.interceptors.request.use((config) => {

    const token = getToken()

    if (token) config.headers.Authorization = `Bearer ${token}`
    return config

})

// Response Interceptores: runs after respose 
// If the backend says 401, (token missing , expired ) clear the token
// and add bounce to the login page.

api.interceptors.response.use(
    (response) => response, (error) => {
        if (error.response?.status === 401) {
            clearToken()

            if (typeof window !== 'undefined' && window.location.pathname !== "/login") {
                window.location.href = "/login"
            }
        }
        return Promise.reject(error)
    }
)