import { Divider, Switch, Title2 } from "@fluentui/react-components";

import "./Header.css";

interface Props {
    toggleMode: (mode: boolean) => void;
    darkMode: boolean;
}

export const Header = ({ toggleMode, darkMode }: Props) => {
    return (
        <>
            <div className="header">
                <Title2> Multimodal RAG + Azure AI Search</Title2>
                <div className="header-right">
                    <Switch
                        checked={darkMode}
                        label={`Dark Mode`}
                        onChange={() => {
                            toggleMode(!darkMode);
                        }}
                    />
                </div>
            </div>
            <Divider />
        </>
    );
};
