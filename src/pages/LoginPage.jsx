import { useState } from 'react';
import { supabase } from '../config/supabase';
//import { useAuth } from '../contexts/AuthContext';

const LoginPage = ({ onSignup, onLoginSuccess }) => {
    //const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const containerStyle = {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        width: '100vw',
        backgroundColor: '#1a1a1a',
        fontFamily: 'Arial, sans-serif',
        padding: '20px',
        color: 'white',
        background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)',
    }
    
    const formContainerStyle = {
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        borderRadius: '20px',
        padding: '40px',
        boxShadow: '0 10px 40px rgba(0, 0, 0, 0.3)',
        width: '100%',
        maxWidth: '400px',
        color: '#1a1a1a',
    }
    
    const titleStyle = {
        fontSize: '2.5rem',
        fontWeight: 'bold',
        color: '#ff6b6b',
        marginBottom: '0.5rem',
        textAlign: 'center',
        textShadow: '2px 2px 4px rgba(0, 0, 0, 0.2)',
    }

    const subtitleStyle = {
        fontSize: '1rem',
        color: '#666',
        marginBottom: '2rem',
        textAlign: 'center',
    }
    
    const inputStyle = {
        width: '100%',
        padding: '15px',
        marginBottom: '20px',
        borderRadius: '12px',
        border: '2px solid #e0e0e0',
        fontSize: '1rem',
        transition: 'border-color 0.3s ease',
        boxSizing: 'border-box',
    }
    
    const buttonStyle = {
        width: '100%',
        backgroundColor: '#ff6b6b',
        color: 'white',
        border: 'none',
        borderRadius: '12px',
        padding: '15px',
        fontSize: '1.2rem',
        fontWeight: 'bold',
        cursor: 'pointer',
        boxShadow: '0 8px 16px rgba(255, 107, 107, 0.3)',
        transition: 'all 0.3s ease',
        textTransform: 'uppercase',
        letterSpacing: '1px',
        marginTop: '20px',
    }

    const handleLogin = async (e) => {
        e.preventDefault();
        if (!email || !password) {
            setError('Please fill in all fields')
            return
        }
        try {
        setLoading(true);
        setError('');
        
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
        })

    
        if (error) throw error;
        
        if (onLoginSuccess) {
            onLoginSuccess()
        }

        } catch (error) {
        console.error('Error logging in:', error)
        setError(error.message || 'Failed to login. Retry')
        } finally {
        setLoading(false);
        }
    };
    
    const handleKeyPress = (e) => {
        if (e.key === 'Enter') {
        handleLogin(e);
        }
    }

    return (
        <div style={containerStyle}>
    <div style={formContainerStyle}>
        <h1 style={titleStyle}>Welcome Back</h1>
        <p style={subtitleStyle}>Sign in to your account</p>

        <form onSubmit={handleLogin}>
        <div>
            <label htmlFor="email" style={{ display: 'block', marginBottom: '8px', fontWeight: '600' }}>
            Email
            </label>
            <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyPress={handleKeyPress}
            style={inputStyle}
            placeholder="you@example.com"
            required
            />
        </div>
    
        <div>
            <label htmlFor="password" style={{ display: 'block', marginBottom: '8px', fontWeight: '600' }}>
            Password
            </label>
            <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyPress={handleKeyPress}
            style={inputStyle}
            placeholder="••••••••"
            required
            />
        </div>
    
        {error && (
            <div style={{
            padding: '12px',
            borderRadius: '8px',
            backgroundColor: '#fee',
            color: '#c33',
            border: '1px solid #fcc',
            marginBottom: '15px',
            fontSize: '0.9rem',
            }}>
            {error}
            </div>
        )}
    
    <button
            type="submit"
            disabled={loading}
            style={{
            ...buttonStyle,
            opacity: loading ? 0.7 : 1,
            cursor: loading ? 'not-allowed' : 'pointer',
            }}
        >
            {loading ? 'Signing in...' : 'Sign In'}
        </button>
        </form>
    
        <div style={{ marginTop: '20px', textAlign: 'center', color: '#666' }}>
        <p style={{ fontSize: '0.9rem' }}>
            Don't have an account?{' '}
            <button
            onClick={onSignup}
            style={{
                background: 'none',
                border: 'none',
                color: '#ff6b6b',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '0.9rem',
                textDecoration: 'underline',
            }}
            >
            Sign up
            </button>
        </p>
        </div>
        </div>
        </div>
    );
    }
    export default LoginPage;
    