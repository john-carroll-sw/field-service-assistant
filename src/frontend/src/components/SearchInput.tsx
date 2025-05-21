import React, { useState } from "react";

import { Button, Caption1, Spinner } from "@fluentui/react-components";
import { Search20Filled } from "@fluentui/react-icons";

import "./SearchInput.css";

interface SearchInputProps {
    isLoading: boolean;
    onSearch: (query: string) => void;
}

const SearchInput: React.FC<SearchInputProps> = ({ isLoading, onSearch }) => {
    const [query, setQuery] = useState("");

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setQuery(e.target.value);
    };

    const handleSearch = () => {
        if (query.trim()) {
            onSearch(query.trim());
            setQuery("");
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            handleSearch();
        }
    };

    return (
        <>
            {isLoading && <div className="loading">Generating answer, please wait...</div>}

            <div className="search-container" style={{ boxShadow: "0px 4px 6px rgba(0, 0, 0, 0.1)" }}>
                <input
                    disabled={isLoading}
                    className="input"
                    type="text"
                    placeholder="Ask about your data..."
                    value={query}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                />
                <div className="search-controls">
                    <Button
                        disabled={isLoading}
                        shape="circular"
                        size="large"
                        appearance="primary"
                        icon={isLoading ? <Spinner size="extra-small" /> : <Search20Filled />}
                        onClick={handleSearch}
                    />
                </div>
            </div>
            <Caption1 style={{ marginTop: "5px", color: "lightgray" }} block align="center" italic>
                AI-generated content may be incorrect
            </Caption1>
        </>
    );
};

export default SearchInput;
