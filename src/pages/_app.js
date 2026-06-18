import '@/styles/globals.scss';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { AuthProvider } from '@/contexts/AuthContext';
import { DateRangeProvider } from '@/contexts/DateRangeContext';
import { FilterProvider } from '@/contexts/FilterContext';
import { ThemeProvider } from '@/contexts/ThemeContext';

export default function App({ Component, pageProps }) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  const tree = (
    <ThemeProvider>
      <AuthProvider>
        <DateRangeProvider>
          <FilterProvider>
            <Component {...pageProps} />
          </FilterProvider>
        </DateRangeProvider>
      </AuthProvider>
    </ThemeProvider>
  );

  return clientId ? (
    <GoogleOAuthProvider clientId={clientId}>{tree}</GoogleOAuthProvider>
  ) : tree;
}
