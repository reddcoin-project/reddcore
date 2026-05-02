import useSWR from 'swr';
import {urlSafetyCheck} from '../utilities/helper-methods';
import axios, {AxiosRequestConfig} from 'axios';

export const fetcher = (url: string, config?: AxiosRequestConfig) =>
  axios.get(url, config).then(res => res.data);
// SWR's first arg is the cache key; passing `null` is the documented
// way to skip the request ("conditional fetching"). Allow callers to
// pass a nullable URL so they can gate on params being available
// without an extra wrapper.
export const useApi = (url: string | null, options?: object) =>
  useSWR(url ? urlSafetyCheck(url) : null, fetcher, options);
